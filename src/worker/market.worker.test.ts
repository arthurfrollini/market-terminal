import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FromWorker, ToWorker } from '../market/types'

class FakeWebSocket {
  static all: FakeWebSocket[] = []
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  closedWith: number | null = null
  sent: string[] = []
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.all.push(this)
  }
  send(text: string) {
    this.sent.push(text)
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

const start = { type: 'start', symbol: 'BTCUSDT', wsBase: 'wss://host', grouping: 0.01, tickSize: 0.01, interval: '1m' } as const

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
    expect(ws.url).toBe('wss://host/stream?streams=btcusdt@depth@100ms/btcusdt@trade/btcusdt@miniTicker/btcusdt@kline_1m')
    expect(scope.posted).toContainEqual({
      type: 'status',
      status: { state: 'connecting', attempt: 0, retryInMs: null, source: 'binance' },
    })

    ws.onopen!(new Event('open'))
    expect(scope.posted).toContainEqual({ type: 'need-snapshot', symbol: 'BTCUSDT', reason: 'initial' })
    expect(scope.posted).toContainEqual({ type: 'need-history', symbol: 'BTCUSDT', interval: '1m' })
  })

  it('switches the kline stream on the open socket when the interval changes', () => {
    send(start)
    const [ws] = FakeWebSocket.all
    ws.onopen!(new Event('open'))
    scope.posted = []
    send({ type: 'interval', interval: '5m' })
    expect(ws.sent.map((t) => JSON.parse(t))).toEqual([
      { method: 'UNSUBSCRIBE', params: ['btcusdt@kline_1m'], id: 1 },
      { method: 'SUBSCRIBE', params: ['btcusdt@kline_5m'], id: 2 },
    ])
    expect(scope.posted).toEqual([{ type: 'need-history', symbol: 'BTCUSDT', interval: '5m' }])
    expect(FakeWebSocket.all).toHaveLength(1)

    // A later reconnect opens straight onto the new interval.
    send({ type: 'drop' })
    vi.advanceTimersByTime(1_000)
    expect(FakeWebSocket.all[1].url).toContain('btcusdt@kline_5m')
  })

  it('applies history for the current interval', () => {
    send(start)
    const candle = { openTime: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }
    send({ type: 'history', symbol: 'BTCUSDT', interval: '1m', candles: [candle] })
    expect(Array.from(pull()!.candles!.close)).toEqual([1.5])
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
    expect(scope.posted).toContainEqual({ type: 'need-history', symbol: 'BTCUSDT', interval: '1m' })
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
