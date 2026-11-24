import { describe, expect, it, vi } from 'vitest'
import type { DepthSnapshot } from '../domain/binance'
import type { Candle } from '../domain/candles'
import { SyntheticFeed, mulberry32 } from '../feed/synthetic'
import { MarketEngine, frameTransferables } from './engine'

const msg = (stream: string, data: object) => JSON.stringify({ stream: `btcusdt@${stream}`, data })
const depth = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []) =>
  msg('depth@100ms', { e: 'depthUpdate', E: 1, s: 'BTCUSDT', U, u, b, a })
const trade = (t: number, p: string, q: string, m: boolean) =>
  msg('trade', { e: 'trade', E: 1, s: 'BTCUSDT', t, p, q, T: 1, m })
const kline = (t: number, c: string, i = '1m') =>
  msg(`kline_${i}`, { e: 'kline', E: 1, s: 'BTCUSDT', k: { t, T: t + 59_999, s: 'BTCUSDT', i, o: '100', c, h: '110', l: '90', v: '7', x: false } })
const candle = (openTime: number, close: number): Candle => ({ openTime, open: close, high: close, low: close, close, volume: 1 })

const snapshot: DepthSnapshot = {
  lastUpdateId: 10,
  bids: [['100.00', '1'], ['99.00', '1']],
  asks: [['101.00', '2'], ['102.00', '2']],
}

function setup() {
  let now = 1_000
  const onNeedSnapshot = vi.fn()
  const onNeedHistory = vi.fn()
  const engine = new MarketEngine({ onNeedSnapshot, onNeedHistory, now: () => now, clock: () => 0, depthBuckets: 4 })
  engine.start('BTCUSDT', 1)
  return { engine, onNeedSnapshot, onNeedHistory, tick: (ms: number) => (now += ms) }
}

describe('MarketEngine', () => {
  it('requests a snapshot on resync and goes live once it arrives', () => {
    const { engine, onNeedSnapshot } = setup()
    engine.resync('initial')
    expect(onNeedSnapshot).toHaveBeenCalledWith('initial')
    engine.handleMessage(depth(11, 11, [['100.00', '5']]))
    expect(engine.buildFrame()?.book?.status).toBe('buffering')

    engine.applySnapshot('BTCUSDT', snapshot)
    const book = engine.buildFrame()!.book!
    expect(book.status).toBe('live')
    expect(book.bestBid).toBe(100)
    expect(book.bestAsk).toBe(101)
    expect(book.spread).toBe(1)
    expect(book.bids.qtys[0]).toBe(5)
  })

  it('ignores a snapshot for another symbol', () => {
    const { engine } = setup()
    engine.resync('initial')
    engine.applySnapshot('ETHUSDT', snapshot)
    expect(engine.bookState).toBe('buffering')
  })

  it('reports a sequence gap', () => {
    const { engine, onNeedSnapshot } = setup()
    engine.resync('initial')
    engine.applySnapshot('BTCUSDT', snapshot)
    engine.handleMessage(depth(50, 51))
    expect(onNeedSnapshot).toHaveBeenLastCalledWith('gap')
    expect(engine.bookState).toBe('buffering')
  })

  it('coalesces trades between frames and computes flow stats', () => {
    const { engine } = setup()
    engine.handleMessage(trade(1, '100', '1', false))
    engine.handleMessage(trade(2, '110', '3', true))
    const frame = engine.buildFrame()!
    expect(frame.trades.map((t) => [t.id, t.side])).toEqual([[1, 'buy'], [2, 'sell']])
    expect(frame.stats.vwap).toBe(107.5)
    expect(frame.stats.buyShare).toBe(0.25)
    expect(frame.stats.msgsPerSec).toBe(2)
    // Nothing new: no frame until the stats refresh interval passes.
    expect(engine.buildFrame()).toBeNull()
  })

  it('turns the mini ticker into a ticker with the 24h change', () => {
    const { engine } = setup()
    const ticker = (o: string) =>
      msg('miniTicker', { e: '24hrMiniTicker', E: 1, s: 'BTCUSDT', c: '110', o, h: '120', l: '90', v: '5', q: '550' })
    engine.handleMessage(ticker('100'))
    expect(engine.buildFrame()!.ticker).toEqual({
      symbol: 'BTCUSDT', last: 110, open: 100, high: 120, low: 90, baseVolume: 5, quoteVolume: 550, changePct: 10,
    })
    expect(engine.buildFrame()).toBeNull()

    engine.handleMessage(ticker('0'))
    expect(engine.buildFrame()!.ticker!.changePct).toBe(0)
  })

  it('keeps only the newest trades when the UI stops pulling', () => {
    const engine = new MarketEngine({ onNeedSnapshot: vi.fn(), maxPendingTrades: 2 })
    engine.start('BTCUSDT', 1)
    for (let id = 1; id <= 4; id++) engine.handleMessage(trade(id, '100', '1', false))
    expect(engine.buildFrame()!.trades.map((t) => t.id)).toEqual([3, 4])
  })

  it('refreshes stats periodically even when the market is quiet', () => {
    const { engine, tick } = setup()
    engine.buildFrame()
    tick(300)
    const frame = engine.buildFrame()
    expect(frame).not.toBeNull()
    expect(frame!.book).toBeNull()
    expect(frame!.trades).toEqual([])
  })

  it('falls back to the last trade price while the book is resyncing', () => {
    const { engine } = setup()
    engine.resync('initial')
    expect(engine.referencePrice).toBeNull()
    engine.handleMessage(trade(1, '123.45', '1', false))
    expect(engine.referencePrice).toBe(123.45)
  })

  it('never lists the same buffer twice for transfer', () => {
    const { engine } = setup()
    engine.resync('initial') // empty book: depth curves share one empty array
    const frame = engine.buildFrame()!
    const list = frameTransferables(frame)
    expect(new Set(list).size).toBe(list.length)
  })

  it('stays in sync with the synthetic feed: no gaps, never crossed', () => {
    const { engine, onNeedSnapshot } = setup()
    const feed = new SyntheticFeed({
      symbol: 'BTCUSDT',
      midPrice: 60_000,
      tickSize: 0.01,
      messagesPerSecond: 20_000,
      onMessage: (text) => engine.handleMessage(text),
      random: mulberry32(42),
      now: () => 0,
    })
    engine.setGrouping(0.01)
    engine.resync('initial', false)
    engine.applySnapshot('BTCUSDT', feed.snapshot())
    let candles = 0
    for (let i = 0; i < 500; i++) {
      feed.tick()
      const frame = engine.buildFrame()
      const book = frame?.book
      if (book) expect(book.bestBid!).toBeLessThan(book.bestAsk!)
      if (frame?.candles) candles = frame.candles.time.length
    }
    expect(candles).toBe(1)
    expect(onNeedSnapshot).not.toHaveBeenCalled()
    expect(engine.bookState).toBe('live')
  }, 30_000) // ~2 s locally with coverage, over 5 s on a busy CI runner

  describe('candles', () => {
    const closes = (frame: ReturnType<MarketEngine['buildFrame']>) => Array.from(frame!.candles!.close)

    it('puts a kline in the next frame, then sends no candles until they change', () => {
      const { engine } = setup()
      engine.handleMessage(kline(0, '105'))
      const candles = engine.buildFrame()!.candles!
      expect(candles).toMatchObject({ symbol: 'BTCUSDT', interval: '1m' })
      expect([candles.time[0], candles.open[0], candles.high[0], candles.low[0], candles.close[0], candles.volume[0]])
        .toEqual([0, 100, 110, 90, 105, 7])
      engine.handleMessage(trade(1, '100', '1', false))
      expect(engine.buildFrame()!.candles).toBeNull()
    })

    it('ignores klines for another interval, like one in flight after unsubscribing', () => {
      const { engine } = setup()
      engine.setInterval('5m')
      engine.handleMessage(kline(0, '105', '1m'))
      expect(engine.buildFrame()!.candles!.time).toHaveLength(0)
    })

    it('asks for history when the interval changes', () => {
      const { engine, onNeedHistory } = setup()
      engine.setInterval('15m')
      expect(engine.interval).toBe('15m')
      expect(onNeedHistory).toHaveBeenCalledTimes(1)
    })

    it('ignores history for a symbol or interval it no longer shows', () => {
      const { engine } = setup()
      engine.applyHistory('ETHUSDT', '1m', [candle(0, 1)])
      engine.applyHistory('BTCUSDT', '5m', [candle(0, 1)])
      expect(engine.buildFrame()!.candles!.time).toHaveLength(0)
    })

    it('starts over on a history request, so candles closed while offline come from REST', () => {
      const { engine } = setup()
      engine.handleMessage(kline(0, '105')) // last update before the connection dropped
      engine.requestHistory()
      engine.applyHistory('BTCUSDT', '1m', [candle(0, 120), candle(60_000, 130)])
      expect(closes(engine.buildFrame())).toEqual([120, 130])
    })

    it('keeps a kline that arrived after the history request over the history', () => {
      const { engine } = setup()
      engine.requestHistory()
      engine.handleMessage(kline(60_000, '131'))
      engine.applyHistory('BTCUSDT', '1m', [candle(0, 120), candle(60_000, 130)])
      expect(closes(engine.buildFrame())).toEqual([120, 131])
    })

    it('forgets candles when the symbol changes', () => {
      const { engine } = setup()
      engine.handleMessage(kline(0, '105'))
      engine.start('ETHUSDT', 1)
      expect(engine.buildFrame()!.candles!.time).toHaveLength(0)
    })

    it('lists every candle buffer once for transfer, next to the book', () => {
      const { engine } = setup()
      engine.resync('initial')
      engine.handleMessage(kline(0, '105'))
      const frame = engine.buildFrame()!
      const list = frameTransferables(frame)
      expect(list).toContain(frame.candles!.close.buffer)
      expect(list).toContain(frame.book!.bids.prices.buffer)
      expect(new Set(list).size).toBe(list.length)
    })
  })
})
