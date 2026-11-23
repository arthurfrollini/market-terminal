import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FromWorker, ToWorker } from '../market/types'

class FakeWebSocket {
  static all: FakeWebSocket[] = []
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  closedWith: number | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.all.push(this)
  }
  close(code?: number) {
    this.closedWith = code ?? 1000
  }
}

/** Stands in for the worker's global scope. */
const scope = {
  posted: [] as FromWorker[],
  transfers: [] as Transferable[][],
  onmessage: null as ((e: MessageEvent<ToWorker>) => void) | null,
  postMessage(msg: FromWorker, transfer: Transferable[]) {
    this.posted.push(msg)
    this.transfers.push(transfer)
  },
}

function send(msg: ToWorker) {
  scope.onmessage!({ data: msg } as MessageEvent<ToWorker>)
}

function pull() {
  send({ type: 'pull' })
  const reply = scope.posted.at(-1)
  if (reply?.type !== 'frame') throw new Error('pull got no frame back')
  return reply.frame
}

const start = { type: 'start', symbol: 'BTCUSDT', wsBase: 'wss://host', grouping: 0.01, tickSize: 0.01 } as const

beforeEach(async () => {
  vi.useFakeTimers()
  FakeWebSocket.all = []
  scope.posted = []
  scope.transfers = []
  vi.stubGlobal('self', scope)
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.resetModules()
  await import('./market.worker')
})

afterEach(() => {
  send({ type: 'stress', enabled: false, messagesPerSecond: 0 }) // stops a running synthetic feed
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('market worker', () => {
  it('connects to the combined stream and asks for a snapshot on open', () => {
    send(start)
    const [ws] = FakeWebSocket.all
    expect(ws.url).toBe('wss://host/stream?streams=btcusdt@depth@100ms/btcusdt@trade/btcusdt@miniTicker')
    expect(scope.posted).toContainEqual({
      type: 'status',
      status: { state: 'connecting', attempt: 0, retryInMs: null, source: 'binance' },
    })

    ws.onopen!(new Event('open'))
    expect(scope.posted).toContainEqual({ type: 'need-snapshot', symbol: 'BTCUSDT', reason: 'initial' })
  })

  it('applies the snapshot and stream messages, then answers pulls with a frame', () => {
    send(start)
    const [ws] = FakeWebSocket.all
    ws.onopen!(new Event('open'))
    send({ type: 'snapshot', symbol: 'BTCUSDT', snapshot: { lastUpdateId: 10, bids: [['100', '1']], asks: [['101', '1']] } })
    const data = { e: 'depthUpdate', E: 1, s: 'BTCUSDT', U: 11, u: 11, b: [['100', '3']], a: [] }
    ws.onmessage!({ data: JSON.stringify({ stream: 'btcusdt@depth@100ms', data }) } as MessageEvent)

    const frame = pull()
    expect(frame?.book).toMatchObject({ status: 'live', bestBid: 100, bestAsk: 101 })
    expect(frame?.book?.bids.qtys[0]).toBe(3)
    expect(scope.transfers.at(-1)!.length).toBeGreaterThan(0)
  })

  it('regroups the book when the grouping changes', () => {
    send(start)
    FakeWebSocket.all[0].onopen!(new Event('open'))
    send({ type: 'snapshot', symbol: 'BTCUSDT', snapshot: { lastUpdateId: 1, bids: [['100.4', '1'], ['100.2', '1']], asks: [['101', '1']] } })
    send({ type: 'grouping', step: 1 })
    expect(pull()?.book).toMatchObject({ grouping: 1 })
  })

  it('reconnects when the UI drops the connection', () => {
    send(start)
    const [ws] = FakeWebSocket.all
    ws.onopen!(new Event('open'))
    send({ type: 'drop' })
    expect(ws.closedWith).toBe(4001)
    vi.advanceTimersByTime(1_000)
    expect(FakeWebSocket.all).toHaveLength(2)
  })

  it('runs the synthetic feed in stress mode, without a socket', () => {
    send({ type: 'stress', enabled: true, messagesPerSecond: 1_000 })
    expect(scope.posted).toHaveLength(0) // nothing to run until a symbol starts

    send(start)
    expect(FakeWebSocket.all).toHaveLength(0)
    expect(scope.posted).toContainEqual({
      type: 'status',
      status: { state: 'open', attempt: 0, retryInMs: null, source: 'synthetic' },
    })
    vi.advanceTimersByTime(100)
    const frame = pull()
    expect(frame?.book?.status).toBe('live')
    expect(frame?.stats.msgsPerSec).toBeGreaterThan(0)
  })

  it('switching stress off closes the synthetic feed and opens the socket', () => {
    send({ type: 'stress', enabled: true, messagesPerSecond: 1_000 })
    send(start)
    send({ type: 'stress', enabled: false, messagesPerSecond: 1_000 })
    expect(FakeWebSocket.all).toHaveLength(1)
  })

  it('still answers a pull when building the frame throws', async () => {
    const { MarketEngine } = await import('./engine')
    vi.spyOn(MarketEngine.prototype, 'buildFrame').mockImplementation(() => {
      throw new Error('boom')
    })
    send(start)
    expect(() => send({ type: 'pull' })).toThrow('boom')
    expect(scope.posted.at(-1)).toEqual({ type: 'frame', frame: null })
  })
})
