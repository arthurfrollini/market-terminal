import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DepthSnapshot } from '../domain/binance'
import type { BookFrame, FromWorker, MarketStats, ToWorker, Trade, WorkerFrame } from './types'

class FakeWorker {
  static last: FakeWorker
  posted: ToWorker[] = []
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null
  terminated = false

  constructor() {
    FakeWorker.last = this
  }
  postMessage(msg: ToWorker) {
    this.posted.push(msg)
  }
  terminate() {
    this.terminated = true
  }
  reply(msg: FromWorker) {
    this.onmessage?.({ data: msg } as MessageEvent<FromWorker>)
  }
  sent(type: ToWorker['type']) {
    return this.posted.filter((m) => m.type === type)
  }
}

let rafQueue: FrameRequestCallback[] = []
/** Runs every callback scheduled for the next animation frame. */
function animationFrame(now: number) {
  const queue = rafQueue
  rafQueue = []
  for (const cb of queue) cb(now)
}

const snapshot: DepthSnapshot = { lastUpdateId: 1, bids: [['100', '1']], asks: [['101', '1']] }
const stats = (over: Partial<MarketStats> = {}): MarketStats => ({
  msgsPerSec: 0,
  tradesPerSec: 0,
  buyShare: null,
  vwap: null,
  imbalance: 0,
  workerLoad: 0,
  lastEventTime: 0,
  ...over,
})
const frame = (over: Partial<WorkerFrame> = {}): WorkerFrame => ({
  seq: 1,
  symbol: 'BTCUSDT',
  sentAt: 0,
  book: null,
  trades: [],
  ticker: null,
  candles: null,
  stats: stats(),
  ...over,
})
const trade = (id: number): Trade => ({ id, price: 100, qty: 1, time: 0, side: 'buy' })
const liveBook = { status: 'live' } as BookFrame

const fetchMock = vi.fn<typeof fetch>()

async function setup() {
  vi.resetModules()
  const { marketClient } = await import('./client')
  const { useMarketStore, tradeTape } = await import('./store')
  marketClient.start('BTCUSDT', 0.01)
  return { client: marketClient, store: useMarketStore, tape: tradeTape, worker: FakeWorker.last }
}

beforeEach(() => {
  rafQueue = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafQueue.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafQueue = []
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(performance, 'now').mockReturnValue(0)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(snapshot)))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MarketClient', () => {
  it('configures stress mode before starting, using the tick size as the default grouping', async () => {
    const { worker } = await setup()
    expect(worker.posted).toEqual([
      { type: 'stress', enabled: false, messagesPerSecond: 5000 },
      { type: 'start', symbol: 'BTCUSDT', wsBase: 'wss://data-stream.binance.vision', grouping: 0.01, tickSize: 0.01, interval: '1m' },
    ])
  })

  it('keeps one pull in flight, however many frames go by', async () => {
    const { worker } = await setup()
    animationFrame(16)
    animationFrame(32)
    animationFrame(48)
    expect(worker.sent('pull')).toHaveLength(1)

    worker.reply({ type: 'frame', frame: null })
    animationFrame(64)
    expect(worker.sent('pull')).toHaveLength(2)
  })

  it('samples the frame rate every half second', async () => {
    const { store } = await setup()
    for (let t = 16; t <= 496; t += 16) animationFrame(t)
    expect(store.getState().fps).toBe(0)
    animationFrame(512)
    expect(store.getState().fps).toBe(Math.round((32 * 1000) / 512))
  })

  it('applies a frame: book, ticker, stats, trade count and the trade tape', async () => {
    const { store, tape, worker } = await setup()
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    worker.reply({
      type: 'frame',
      frame: frame({ book: liveBook, trades: [trade(1), trade(2)], stats: stats({ msgsPerSec: 9, lastEventTime: 9_800 }) }),
    })
    const s = store.getState()
    expect(s.book).toBe(liveBook)
    expect(s.stats.msgsPerSec).toBe(9)
    expect(s.tradesTotal).toBe(2)
    expect(s.eventLagMs).toBe(200)
    expect(tape.at(0)?.id).toBe(2)
  })

  it('keeps the last book and event lag when a frame only refreshes stats', async () => {
    const { store, worker } = await setup()
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    worker.reply({ type: 'frame', frame: frame({ book: liveBook, stats: stats({ lastEventTime: 9_900 }) }) })
    worker.reply({ type: 'frame', frame: frame({ stats: stats({ lastEventTime: 5_000 }) }) })
    expect(store.getState().book).toBe(liveBook)
    expect(store.getState().eventLagMs).toBe(100)
  })

  it('ignores frames for a symbol the user already left', async () => {
    const { client, store, tape, worker } = await setup()
    client.selectSymbol('ETHUSDT')
    worker.reply({ type: 'frame', frame: frame({ symbol: 'BTCUSDT', trades: [trade(1)] }) })
    expect(store.getState().tradesTotal).toBe(0)
    expect(tape.length).toBe(0)
  })

  it('stores connection status from the worker', async () => {
    const { store, worker } = await setup()
    const status = { state: 'reconnecting', attempt: 2, retryInMs: 900, source: 'binance' } as const
    worker.reply({ type: 'status', status })
    expect(store.getState().conn).toEqual(status)
  })

  it('fetches a snapshot on request and counts resyncs, except the initial one', async () => {
    const { store, worker } = await setup()
    worker.reply({ type: 'need-snapshot', symbol: 'BTCUSDT', reason: 'initial' })
    await vi.waitFor(() => expect(worker.sent('snapshot')).toHaveLength(1))
    expect(store.getState().resyncs).toBe(0)
    expect(fetchMock.mock.calls[0][0]).toBe('https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=5000')
    expect(worker.sent('snapshot')[0]).toEqual({ type: 'snapshot', symbol: 'BTCUSDT', snapshot })

    worker.reply({ type: 'need-snapshot', symbol: 'BTCUSDT', reason: 'gap' })
    await vi.waitFor(() => expect(worker.sent('snapshot')).toHaveLength(2))
    expect(store.getState()).toMatchObject({ resyncs: 1, lastResync: 'gap' })
  })

  it('drops a snapshot that arrives after the user switched symbols', async () => {
    const { client, worker } = await setup()
    worker.reply({ type: 'need-snapshot', symbol: 'BTCUSDT', reason: 'initial' })
    client.selectSymbol('ETHUSDT')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await new Promise((r) => setTimeout(r, 0))
    expect(worker.sent('snapshot')).toHaveLength(0)
  })

  describe('when the snapshot request fails', () => {
    async function failOnce() {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const ctx = await setup()
      fetchMock.mockResolvedValueOnce(new Response('', { status: 400 }))
      ctx.worker.reply({ type: 'need-snapshot', symbol: 'BTCUSDT', reason: 'initial' })
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledOnce()
      return ctx
    }

    it('tries again after 2 s', async () => {
      const { worker } = await failOnce()
      await vi.advanceTimersByTimeAsync(1_999)
      expect(fetchMock).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(worker.sent('snapshot')).toHaveLength(1)
    })

    it('gives up if the book went live meanwhile', async () => {
      const { store } = await failOnce()
      store.setState({ book: liveBook })
      await vi.advanceTimersByTimeAsync(2_000)
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('gives up if the user switched to stress mode', async () => {
      const { client } = await failOnce()
      client.setStress(true)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(fetchMock).toHaveBeenCalledOnce()
    })
  })

  it('switching symbols resets market data but keeps stress preferences', async () => {
    const { client, store, tape, worker } = await setup()
    client.setStress(true, 20_000)
    worker.reply({ type: 'frame', frame: frame({ trades: [trade(1)] }) })
    client.selectSymbol('ETHUSDT')
    expect(store.getState()).toMatchObject({ symbol: 'ETHUSDT', tradesTotal: 0, stress: true, stressRate: 20_000 })
    expect(tape.length).toBe(0)

    client.selectSymbol('ETHUSDT')
    expect(store.getState().symbol).toBe('ETHUSDT')
  })

  it('forwards grouping, stress and drop to the worker', async () => {
    const { client, store, tape, worker } = await setup()
    worker.reply({ type: 'frame', frame: frame({ book: liveBook, trades: [trade(1)] }) })

    client.setGrouping(10)
    expect(store.getState().grouping).toBe(10)
    expect(worker.posted.at(-1)).toEqual({ type: 'grouping', step: 10 })

    client.setStress(true)
    expect(worker.posted.at(-1)).toEqual({ type: 'stress', enabled: true, messagesPerSecond: 5000 })
    expect(store.getState()).toMatchObject({ stress: true, book: null, tradesTotal: 0 })
    expect(tape.length).toBe(0)

    client.dropConnection()
    expect(worker.posted.at(-1)).toEqual({ type: 'drop' })
  })

  it('stop terminates the worker and the next start creates a new one', async () => {
    const { client, worker } = await setup()
    client.stop()
    expect(worker.terminated).toBe(true)
    expect(rafQueue).toHaveLength(0)

    client.start('BTCUSDT', 0.01)
    expect(FakeWorker.last).not.toBe(worker)
  })
})
