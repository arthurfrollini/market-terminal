import { depthCurve, groupLevels } from '../domain/aggregate'
import { parseStreamMessage, type DepthSnapshot, type StreamEvent } from '../domain/binance'
import { RollingSum, Vwap, imbalance } from '../domain/indicators'
import { OrderBook, type ResyncReason } from '../domain/orderBook'
import type { BookFrame, MarketStats, Ticker, Trade, WorkerFrame } from '../market/types'

export interface MarketEngineOptions {
  onNeedSnapshot: (reason: ResyncReason) => void
  ladderDepth?: number
  depthBuckets?: number
  depthRangePct?: number
  /** Trades kept between frames if the UI falls behind; older ones are dropped. */
  maxPendingTrades?: number
  now?: () => number
  clock?: () => number
}

const STATS_REFRESH_MS = 250
const IMBALANCE_LEVELS = 10

/**
 * Everything the worker does to raw stream text, minus I/O: parse, keep the book in sync,
 * aggregate, compute indicators, and coalesce it all into at most one frame per UI pull.
 */
export class MarketEngine {
  symbol = ''
  grouping = 0.01
  private readonly o: Required<MarketEngineOptions>
  private readonly book = new OrderBook()
  private pendingTrades: Trade[] = []
  private ticker: Ticker | null = null
  private bookDirty = false
  private tickerDirty = false
  private lastFrameAt = 0
  private seq = 0
  private lastEventTime = 0
  private lastTradePrice: number | null = null
  private readonly messages = new RollingSum(1000, 10)
  private readonly tradeCount = new RollingSum(1000, 10)
  private readonly buyVolume = new RollingSum(60_000, 60)
  private readonly sellVolume = new RollingSum(60_000, 60)
  private readonly busyMs = new RollingSum(1000, 10)
  private readonly vwap = new Vwap()

  constructor(options: MarketEngineOptions) {
    this.o = {
      ladderDepth: 20,
      depthBuckets: 120,
      depthRangePct: 0.005,
      maxPendingTrades: 2000,
      now: Date.now,
      clock: () => performance.now(),
      ...options,
    }
  }

  get bookState() {
    return this.book.state
  }

  get mid(): number | null {
    const bid = this.book.bids.best()
    const ask = this.book.asks.best()
    return bid !== undefined && ask !== undefined ? (bid + ask) / 2 : null
  }

  /** Best guess at the current price, even while the book is resyncing. */
  get referencePrice(): number | null {
    return this.mid ?? this.lastTradePrice ?? this.ticker?.last ?? null
  }

  /** Forgets everything about the previous symbol. The book stays idle until `resync`. */
  start(symbol: string, grouping: number): void {
    this.symbol = symbol
    this.grouping = grouping
    this.book.state = 'idle'
    this.book.bids.clear()
    this.book.asks.clear()
    this.pendingTrades = []
    this.ticker = null
    this.vwap.clear()
    for (const r of [this.messages, this.tradeCount, this.buyVolume, this.sellVolume, this.busyMs]) r.clear()
    this.lastEventTime = 0
    this.lastTradePrice = null
    this.bookDirty = true
    this.tickerDirty = true
  }

  /**
   * Throws the book away and waits for a snapshot; called on every (re)connect.
   * `request: false` when the caller supplies the snapshot itself (synthetic feed).
   */
  resync(reason: ResyncReason, request = true): void {
    this.book.reset()
    this.bookDirty = true
    if (request) this.o.onNeedSnapshot(reason)
  }

  setGrouping(step: number): void {
    this.grouping = step
    this.bookDirty = true
  }

  applySnapshot(symbol: string, snapshot: DepthSnapshot): void {
    if (symbol !== this.symbol || this.book.state !== 'buffering') return
    const result = this.book.applySnapshot(snapshot)
    this.bookDirty = true
    if (!result.ok) this.o.onNeedSnapshot(result.reason)
  }

  handleMessage(text: string): void {
    const t0 = this.o.clock()
    const ev = parseStreamMessage(text)
    if (ev) this.handleEvent(ev)
    this.busyMs.add(this.o.clock() - t0, this.o.now())
  }

  private handleEvent(ev: StreamEvent): void {
    const now = this.o.now()
    this.messages.add(1, now)
    this.lastEventTime = Math.max(this.lastEventTime, ev.E)
    switch (ev.e) {
      case 'depthUpdate': {
        const result = this.book.applyDiff(ev)
        if (this.book.state === 'live') this.bookDirty = true
        if (!result.ok) {
          this.bookDirty = true
          this.o.onNeedSnapshot(result.reason)
        }
        break
      }
      case 'trade': {
        const price = Number(ev.p)
        const qty = Number(ev.q)
        const side = ev.m ? 'sell' : 'buy'
        this.pendingTrades.push({ id: ev.t, price, qty, time: ev.T, side })
        if (this.pendingTrades.length > this.o.maxPendingTrades * 1.5) {
          this.pendingTrades = this.pendingTrades.slice(-this.o.maxPendingTrades)
        }
        this.tradeCount.add(1, now)
        ;(side === 'buy' ? this.buyVolume : this.sellVolume).add(qty, now)
        this.vwap.add(price, qty)
        this.lastTradePrice = price
        break
      }
      case '24hrMiniTicker': {
        const last = Number(ev.c)
        const open = Number(ev.o)
        this.ticker = {
          symbol: ev.s,
          last,
          open,
          high: Number(ev.h),
          low: Number(ev.l),
          baseVolume: Number(ev.v),
          quoteVolume: Number(ev.q),
          changePct: open > 0 ? ((last - open) / open) * 100 : 0,
        }
        this.tickerDirty = true
        break
      }
    }
  }

  /**
   * Returns everything that changed since the last call, or null if nothing did.
   * Called once per animation frame, so bursts of messages collapse into one UI update.
   */
  buildFrame(): WorkerFrame | null {
    const now = this.o.now()
    const hasTrades = this.pendingTrades.length > 0
    if (!this.bookDirty && !this.tickerDirty && !hasTrades && now - this.lastFrameAt < STATS_REFRESH_MS) {
      return null
    }
    const trades = this.pendingTrades.length > this.o.maxPendingTrades
      ? this.pendingTrades.slice(-this.o.maxPendingTrades)
      : this.pendingTrades
    const frame: WorkerFrame = {
      seq: ++this.seq,
      symbol: this.symbol,
      sentAt: now,
      book: this.bookDirty ? this.buildBook() : null,
      trades,
      ticker: this.tickerDirty ? this.ticker : null,
      stats: this.buildStats(now),
    }
    this.pendingTrades = []
    this.bookDirty = false
    this.tickerDirty = false
    this.lastFrameAt = now
    return frame
  }

  private buildBook(): BookFrame {
    const { bids, asks } = this.book
    const bestBid = bids.best() ?? null
    const bestAsk = asks.best() ?? null
    const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null
    const { ladderDepth, depthBuckets, depthRangePct } = this.o
    const empty = { prices: new Float64Array(0), cumulative: new Float64Array(0) }
    return {
      symbol: this.symbol,
      status: this.book.state,
      lastUpdateId: this.book.lastUpdateId,
      bestBid,
      bestAsk,
      mid,
      spread: mid !== null ? bestAsk! - bestBid! : null,
      grouping: this.grouping,
      bids: groupLevels(bids, this.grouping, ladderDepth),
      asks: groupLevels(asks, this.grouping, ladderDepth),
      depth: {
        bids: mid !== null ? depthCurve(bids, mid, depthRangePct, depthBuckets) : empty,
        asks: mid !== null ? depthCurve(asks, mid, depthRangePct, depthBuckets) : empty,
        rangePct: depthRangePct,
      },
    }
  }

  private buildStats(now: number): MarketStats {
    const buy = this.buyVolume.sum(now)
    const sell = this.sellVolume.sum(now)
    let bidTop = 0
    let askTop = 0
    const { bids, asks } = this.book
    for (let i = 0; i < Math.min(IMBALANCE_LEVELS, bids.size); i++) bidTop += bids.qtyAt(bids.priceAt(i))
    for (let i = 0; i < Math.min(IMBALANCE_LEVELS, asks.size); i++) askTop += asks.qtyAt(asks.priceAt(i))
    return {
      msgsPerSec: this.messages.rate(now),
      tradesPerSec: this.tradeCount.rate(now),
      buyShare: buy + sell > 0 ? buy / (buy + sell) : null,
      vwap: this.vwap.value,
      imbalance: imbalance(bidTop, askTop),
      workerLoad: Math.min(1, this.busyMs.sum(now) / this.busyMs.windowMs),
      lastEventTime: this.lastEventTime,
    }
  }
}

/** Typed-array buffers in a frame, so postMessage can move them instead of copying. */
export function frameTransferables(frame: WorkerFrame): Transferable[] {
  const b = frame.book
  if (!b) return []
  // A Set because listing the same buffer twice makes postMessage throw (DataCloneError).
  return [
    ...new Set([
      b.bids.prices.buffer, b.bids.qtys.buffer, b.bids.totals.buffer,
      b.asks.prices.buffer, b.asks.qtys.buffer, b.asks.totals.buffer,
      b.depth.bids.prices.buffer, b.depth.bids.cumulative.buffer,
      b.depth.asks.prices.buffer, b.depth.asks.cumulative.buffer,
    ]),
  ]
}
