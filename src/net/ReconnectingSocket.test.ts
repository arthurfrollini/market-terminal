import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReconnectingSocket, type SocketLike, type SocketStatus } from './ReconnectingSocket'

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  closedWith: number | null = null
  sent: string[] = []
  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  open() {
    this.onopen?.(new Event('open'))
  }
  message(data: string) {
    this.onmessage?.({ data } as MessageEvent)
  }
  serverClose() {
    this.onclose?.({} as CloseEvent)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number) {
    this.closedWith = code ?? 1000
  }
}

function setup(overrides: Partial<ConstructorParameters<typeof ReconnectingSocket>[0]> = {}) {
  const sockets: FakeSocket[] = []
  const messages: string[] = []
  const statuses: SocketStatus[] = []
  const onOpen = vi.fn()
  const rs = new ReconnectingSocket({
    url: 'wss://example/stream',
    onMessage: (m) => messages.push(m),
    onOpen,
    onStatus: (s) => statuses.push(s),
    createSocket: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    baseDelayMs: 100,
    maxDelayMs: 1000,
    staleAfterMs: 4000,
    random: () => 0.5,
    ...overrides,
  })
  return { rs, sockets, messages, statuses, onOpen, last: () => sockets[sockets.length - 1] }
}

describe('ReconnectingSocket', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('connects, reports open and forwards messages', () => {
    const t = setup()
    t.rs.connect()
    expect(t.statuses.at(-1)?.state).toBe('connecting')
    t.last().open()
    t.last().message('hello')
    expect(t.onOpen).toHaveBeenCalledOnce()
    expect(t.messages).toEqual(['hello'])
    expect(t.statuses.at(-1)).toEqual({ state: 'open', attempt: 0, retryInMs: null })
  })

  it('backs off exponentially with jitter between attempts', () => {
    const t = setup()
    // random = 0.5 → delay = cap/2 + cap/4 = 0.75 * cap
    expect(t.rs.backoff(0)).toBe(75)
    expect(t.rs.backoff(1)).toBe(150)
    expect(t.rs.backoff(10)).toBe(750) // capped at maxDelayMs
  })

  it('reconnects after the server closes, with growing delays', () => {
    const t = setup()
    t.rs.connect()
    t.last().serverClose()
    expect(t.statuses.at(-1)).toEqual({ state: 'reconnecting', attempt: 1, retryInMs: 75 })
    vi.advanceTimersByTime(74)
    expect(t.sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(t.sockets).toHaveLength(2)

    t.last().serverClose()
    expect(t.statuses.at(-1)?.retryInMs).toBe(150)
    vi.advanceTimersByTime(150)
    expect(t.sockets).toHaveLength(3)
  })

  it('resets the attempt counter only once data flows again', () => {
    const t = setup()
    t.rs.connect()
    t.last().serverClose()
    vi.advanceTimersByTime(75)
    t.last().open()
    // An open that dies before any message keeps backing off.
    expect(t.statuses.at(-1)?.attempt).toBe(1)
    t.last().message('x')
    expect(t.statuses.at(-1)).toEqual({ state: 'open', attempt: 0, retryInMs: null })
  })

  it('treats a silent connection as dead and reconnects', () => {
    const t = setup()
    t.rs.connect()
    t.last().open()
    const first = t.last()
    vi.advanceTimersByTime(3000)
    first.message('still alive')
    vi.advanceTimersByTime(3000)
    expect(t.sockets).toHaveLength(1)
    vi.advanceTimersByTime(2000) // > 4000ms since last message
    expect(first.closedWith).toBe(4000)
    expect(t.statuses.at(-1)?.state).toBe('reconnecting')
    vi.advanceTimersByTime(75)
    expect(t.sockets).toHaveLength(2)
  })

  it('ignores events from a socket it already abandoned', () => {
    const t = setup()
    t.rs.connect()
    const first = t.last()
    first.open()
    t.rs.drop()
    first.message('late')
    first.serverClose()
    expect(t.messages).toEqual([])
    // Only the one reconnect scheduled by drop().
    vi.advanceTimersByTime(10_000)
    expect(t.sockets).toHaveLength(2)
  })

  it('stops for good on close()', () => {
    const t = setup()
    t.rs.connect()
    t.last().open()
    t.rs.close()
    expect(t.statuses.at(-1)?.state).toBe('closed')
    vi.advanceTimersByTime(60_000)
    expect(t.sockets).toHaveLength(1)
  })

  it('ignores connect() while running and drop() while stopped', () => {
    const t = setup()
    t.rs.drop()
    expect(t.sockets).toHaveLength(0)
    t.rs.connect()
    t.rs.connect()
    expect(t.sockets).toHaveLength(1)
  })

  it('retries when the socket constructor throws', () => {
    let calls = 0
    const t = setup({
      createSocket: () => {
        calls++
        throw new SyntaxError('bad url')
      },
    })
    t.rs.connect()
    expect(t.statuses.at(-1)?.state).toBe('reconnecting')
    vi.advanceTimersByTime(75)
    expect(calls).toBe(2)
    t.rs.close()
  })

  it('sends only on an open connection', () => {
    const t = setup()
    t.rs.connect()
    expect(t.rs.send('early')).toBe(false)
    t.last().open()
    expect(t.rs.send('hello')).toBe(true)
    expect(t.last().sent).toEqual(['hello'])
    t.rs.drop()
    expect(t.rs.send('while down')).toBe(false)
  })

  it('uses a new URL on the next connection without reconnecting now', () => {
    const t = setup()
    t.rs.connect()
    t.last().open()
    t.rs.setUrl('wss://example/other')
    expect(t.sockets).toHaveLength(1)
    t.rs.drop()
    vi.runOnlyPendingTimers()
    expect(t.last().url).toBe('wss://example/other')
  })
})
