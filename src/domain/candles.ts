export type Interval = '1m' | '5m' | '15m' | '1h'

export const INTERVALS: readonly Interval[] = ['1m', '5m', '15m', '1h']

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
}

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CandleArrays {
  time: Float64Array
  open: Float64Array
  high: Float64Array
  low: Float64Array
  close: Float64Array
  volume: Float64Array
  /** NaN until enough candles for the period. */
  ema: Float64Array
  rsi: Float64Array
}

const EMA_PERIOD = 20
const RSI_PERIOD = 14

/** Exponential moving average seeded with the simple average of the first `period` values. */
export function ema(values: ArrayLike<number>, period: number): Float64Array {
  const out = new Float64Array(values.length).fill(NaN)
  if (values.length < period) return out
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let prev = sum / period
  out[period - 1] = prev
  const k = 2 / (period + 1)
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/** Relative strength index with Wilder's smoothing, 0..100. */
export function rsi(values: ArrayLike<number>, period: number): Float64Array {
  const out = new Float64Array(values.length).fill(NaN)
  if (values.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  out[period] = value()
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = value()
  }
  return out
}

/**
 * Candles ordered by open time, newest last. A kline event carries the whole state of its
 * candle, so updates replace by open time and never add up: the order in which REST history
 * and stream updates arrive doesn't matter.
 */
export class CandleSeries {
  private candles: Candle[] = []
  private readonly capacity: number

  constructor(capacity = 500) {
    this.capacity = capacity
  }

  get length(): number {
    return this.candles.length
  }

  clear(): void {
    this.candles = []
  }

  upsert(c: Candle): void {
    const list = this.candles
    const last = list.at(-1)
    if (!last || c.openTime > last.openTime) {
      list.push(c)
      if (list.length > this.capacity) list.shift()
      return
    }
    const i = this.indexOf(c.openTime)
    if (list[i]?.openTime === c.openTime) list[i] = c
    else if (list.length < this.capacity) list.splice(i, 0, c)
  }

  /** Adds history candles the series doesn't have yet; what came from the stream is newer. */
  merge(history: Candle[]): void {
    const have = new Set(this.candles.map((c) => c.openTime))
    const merged = this.candles.concat(history.filter((c) => !have.has(c.openTime)))
    merged.sort((a, b) => a.openTime - b.openTime)
    this.candles = merged.slice(-this.capacity)
  }

  toArrays(): CandleArrays {
    const n = this.candles.length
    const a = {
      time: new Float64Array(n),
      open: new Float64Array(n),
      high: new Float64Array(n),
      low: new Float64Array(n),
      close: new Float64Array(n),
      volume: new Float64Array(n),
    }
    this.candles.forEach((c, i) => {
      a.time[i] = c.openTime
      a.open[i] = c.open
      a.high[i] = c.high
      a.low[i] = c.low
      a.close[i] = c.close
      a.volume[i] = c.volume
    })
    return { ...a, ema: ema(a.close, EMA_PERIOD), rsi: rsi(a.close, RSI_PERIOD) }
  }

  /** First index whose open time is >= `t`. */
  private indexOf(t: number): number {
    let lo = 0
    let hi = this.candles.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.candles[mid].openTime < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
