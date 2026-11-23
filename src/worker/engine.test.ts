import { describe, expect, it, vi } from 'vitest'
import type { DepthSnapshot } from '../domain/binance'
import { SyntheticFeed, mulberry32 } from '../feed/synthetic'
import { MarketEngine, frameTransferables } from './engine'

const msg = (stream: string, data: object) => JSON.stringify({ stream: `btcusdt@${stream}`, data })
const depth = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []) =>
  msg('depth@100ms', { e: 'depthUpdate', E: 1, s: 'BTCUSDT', U, u, b, a })
const trade = (t: number, p: string, q: string, m: boolean) =>
  msg('trade', { e: 'trade', E: 1, s: 'BTCUSDT', t, p, q, T: 1, m })

const snapshot: DepthSnapshot = {
  lastUpdateId: 10,
  bids: [['100.00', '1'], ['99.00', '1']],
  asks: [['101.00', '2'], ['102.00', '2']],
}

function setup() {
  let now = 1_000
  const onNeedSnapshot = vi.fn()
  const engine = new MarketEngine({ onNeedSnapshot, now: () => now, clock: () => 0, depthBuckets: 4 })
  engine.start('BTCUSDT', 1)
  return { engine, onNeedSnapshot, tick: (ms: number) => (now += ms) }
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
    for (let i = 0; i < 500; i++) {
      feed.tick()
      const book = engine.buildFrame()?.book
      if (book) expect(book.bestBid!).toBeLessThan(book.bestAsk!)
    }
    expect(onNeedSnapshot).not.toHaveBeenCalled()
    expect(engine.bookState).toBe('live')
  })
})
