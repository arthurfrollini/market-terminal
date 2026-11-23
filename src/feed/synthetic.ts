import { stepDecimals } from '../domain/aggregate'
import type { DepthSnapshot, RawLevel } from '../domain/binance'

export interface SyntheticFeedOptions {
  symbol: string
  midPrice: number
  tickSize: number
  messagesPerSecond: number
  onMessage: (text: string) => void
  random?: () => number
  now?: () => number
}

const SNAPSHOT_LEVELS = 1000
const TICK_MS = 10
/** Book depth as a fraction of mid, so the depth chart (±0.5%) has a curve, not a wall. */
const BOOK_SPAN = 0.006

/** Small seeded PRNG so tests get the same stream every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Generates a Binance-shaped stream (depth diffs, trades, mini ticker) at a chosen rate,
 * serialised to JSON so the worker pays the same parse cost as with the real feed.
 * Prices are tracked in integer ticks so the book can never cross.
 */
export class SyntheticFeed {
  private readonly o: Required<SyntheticFeedOptions>
  private readonly decimals: number
  private readonly stream: string
  /** Furthest level from the touch, in ticks. */
  private readonly spanTicks: number
  private bidTick: number
  private askTick: number
  private updateId = 1_000_000
  private tradeId = 1
  private carry = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly openPrice: number
  private high: number
  private low: number
  private volume = 0
  private quoteVolume = 0
  private lastTickerAt = 0

  constructor(options: SyntheticFeedOptions) {
    this.o = { random: Math.random, now: Date.now, ...options }
    this.decimals = stepDecimals(options.tickSize)
    this.stream = options.symbol.toLowerCase()
    this.bidTick = Math.max(SNAPSHOT_LEVELS * 2, Math.floor(options.midPrice / options.tickSize))
    this.askTick = this.bidTick + 1
    this.spanTicks = Math.max(SNAPSHOT_LEVELS, Math.round(this.bidTick * BOOK_SPAN))
    this.openPrice = this.high = this.low = this.price(this.bidTick)
  }

  snapshot(): DepthSnapshot {
    const bids: RawLevel[] = []
    const asks: RawLevel[] = []
    for (let k = 0; k < SNAPSHOT_LEVELS; k++) {
      // Dense near the touch, sparse further out; `+ k` keeps offsets strictly increasing.
      const offset = k + Math.floor((k / SNAPSHOT_LEVELS) ** 2 * (this.spanTicks - SNAPSHOT_LEVELS))
      bids.push([this.fmt(this.bidTick - offset), this.qty()])
      asks.push([this.fmt(this.askTick + offset), this.qty()])
    }
    return { lastUpdateId: this.updateId, bids, asks }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Emits one timer slice worth of messages. Public so tests can drive it without timers. */
  tick(): void {
    const exact = (this.o.messagesPerSecond * TICK_MS) / 1000 + this.carry
    const n = Math.floor(exact)
    this.carry = exact - n
    for (let i = 0; i < n; i++) {
      if (this.o.random() < 0.65) this.emitDepth(this.randomLevels())
      else this.emitTrade()
    }
    const now = this.o.now()
    if (now - this.lastTickerAt >= 250) {
      this.lastTickerAt = now
      this.emitTicker(now)
    }
  }

  private randomLevels(): { b: RawLevel[]; a: RawLevel[] } {
    const b: RawLevel[] = []
    const a: RawLevel[] = []
    const changes = 1 + Math.floor(this.o.random() * 6)
    for (let i = 0; i < changes; i++) {
      // Cubing biases updates towards the top of the book, like real flow.
      const offset = Math.floor(this.o.random() ** 3 * this.spanTicks)
      const qty = this.o.random() < 0.15 ? '0' : this.qty()
      if (this.o.random() < 0.5) b.push([this.fmt(this.bidTick - offset), qty])
      else a.push([this.fmt(this.askTick + offset), qty])
    }
    return { b, a }
  }

  private emitTrade(): void {
    const buy = this.o.random() < 0.5
    const tick = buy ? this.askTick : this.bidTick
    const qty = -Math.log(1 - this.o.random()) * 0.05
    const now = this.o.now()
    const price = this.price(tick)
    this.volume += qty
    this.quoteVolume += qty * price
    this.send('trade', {
      e: 'trade',
      E: now,
      s: this.o.symbol,
      t: this.tradeId++,
      p: this.fmt(tick),
      q: qty.toFixed(5),
      T: now,
      m: !buy,
    })
    if (this.o.random() < 0.12) this.move(buy ? 1 : -1)
  }

  /** Shifts the touch by `d` ticks, clearing levels the new spread would cross. */
  private move(d: number): void {
    const b: RawLevel[] = []
    const a: RawLevel[] = []
    if (d > 0) {
      for (let t = this.askTick; t < this.askTick + d; t++) a.push([this.fmt(t), '0'])
      for (let t = this.bidTick + 1; t <= this.bidTick + d; t++) b.push([this.fmt(t), this.qty()])
    } else {
      for (let t = this.bidTick + d + 1; t <= this.bidTick; t++) b.push([this.fmt(t), '0'])
      for (let t = this.askTick + d; t < this.askTick; t++) a.push([this.fmt(t), this.qty()])
    }
    this.bidTick += d
    this.askTick += d
    const p = this.price(this.bidTick)
    this.high = Math.max(this.high, p)
    this.low = Math.min(this.low, p)
    this.emitDepth({ b, a })
  }

  private emitDepth(levels: { b: RawLevel[]; a: RawLevel[] }): void {
    const U = this.updateId + 1
    this.updateId += levels.b.length + levels.a.length
    this.send('depth@100ms', {
      e: 'depthUpdate',
      E: this.o.now(),
      s: this.o.symbol,
      U,
      u: this.updateId,
      ...levels,
    })
  }

  private emitTicker(now: number): void {
    this.send('miniTicker', {
      e: '24hrMiniTicker',
      E: now,
      s: this.o.symbol,
      c: this.fmt(this.bidTick),
      o: this.openPrice.toFixed(this.decimals),
      h: this.high.toFixed(this.decimals),
      l: this.low.toFixed(this.decimals),
      v: this.volume.toFixed(5),
      q: this.quoteVolume.toFixed(2),
    })
  }

  private send(stream: string, data: object): void {
    this.o.onMessage(JSON.stringify({ stream: `${this.stream}@${stream}`, data }))
  }

  private price(tick: number): number {
    return tick * this.o.tickSize
  }

  private fmt(tick: number): string {
    return this.price(tick).toFixed(this.decimals)
  }

  private qty(): string {
    return (this.o.random() * 2 + 0.001).toFixed(5)
  }
}
