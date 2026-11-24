import { describe, expect, it } from 'vitest'
import { CandleSeries, ema, rsi, type Candle } from './candles'

const candle = (openTime: number, close: number, over: Partial<Candle> = {}): Candle => ({
  openTime,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  ...over,
})

const closes = (s: CandleSeries) => Array.from(s.toArrays().close)
const times = (s: CandleSeries) => Array.from(s.toArrays().time)

describe('ema', () => {
  it('starts from the simple average of the first period, then smooths', () => {
    expect(Array.from(ema([1, 2, 3, 4, 5], 3))).toEqual([NaN, NaN, 2, 3, 4])
  })

  it('is all NaN when there are fewer values than the period', () => {
    expect(Array.from(ema([1, 2], 3))).toEqual([NaN, NaN])
  })
})

describe('rsi', () => {
  it('uses Wilder smoothing after the first average', () => {
    // Changes +1, -1, +1. First averages: gain 0.5, loss 0.5 -> 50.
    // Then gain (0.5 + 1) / 2 = 0.75, loss (0.5 + 0) / 2 = 0.25 -> RS 3 -> 75.
    expect(Array.from(rsi([1, 2, 1, 2], 2))).toEqual([NaN, NaN, 50, 75])
  })

  it('is 100 when there were no losses', () => {
    expect(rsi([1, 2, 3, 4], 2)[3]).toBe(100)
  })
})

describe('CandleSeries', () => {
  it('replaces the candle with the same open time and appends newer ones', () => {
    const s = new CandleSeries()
    s.upsert(candle(0, 1))
    s.upsert(candle(0, 2))
    s.upsert(candle(60, 3))
    expect(times(s)).toEqual([0, 60])
    expect(closes(s)).toEqual([2, 3])
  })

  it('updates an older candle in place', () => {
    const s = new CandleSeries()
    for (const t of [0, 60, 120]) s.upsert(candle(t, t))
    s.upsert(candle(60, 99))
    expect(closes(s)).toEqual([0, 99, 120])
  })

  it('keeps only the newest candles up to its capacity', () => {
    const s = new CandleSeries(3)
    for (const t of [0, 60, 120, 180]) s.upsert(candle(t, t))
    expect(times(s)).toEqual([60, 120, 180])
    s.upsert(candle(0, 5)) // older than everything kept
    expect(times(s)).toEqual([60, 120, 180])
  })

  it('merges history without overwriting candles it already has', () => {
    const history = [candle(0, 1), candle(60, 2), candle(120, 3)]
    const live = candle(120, 30)

    const a = new CandleSeries()
    a.upsert(live)
    a.merge(history)

    const b = new CandleSeries()
    b.merge(history)
    b.upsert(live)

    expect(closes(a)).toEqual([1, 2, 30])
    expect(closes(b)).toEqual(closes(a))
  })

  it('trims merged history to its capacity', () => {
    const s = new CandleSeries(2)
    s.merge([candle(0, 1), candle(60, 2), candle(120, 3)])
    expect(times(s)).toEqual([60, 120])
  })

  it('forgets everything on clear', () => {
    const s = new CandleSeries()
    s.upsert(candle(0, 1))
    s.clear()
    expect(s.length).toBe(0)
  })

  it('exports typed arrays with EMA 20 and RSI 14 over the closes', () => {
    const s = new CandleSeries()
    const values = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5)
    values.forEach((c, i) => s.upsert(candle(i * 60, c, { open: c - 1, high: c + 2, low: c - 3, volume: i })))
    const a = s.toArrays()
    expect(a.time).toBeInstanceOf(Float64Array)
    expect(Array.from(a.open)).toEqual(values.map((c) => c - 1))
    expect(Array.from(a.high)).toEqual(values.map((c) => c + 2))
    expect(Array.from(a.low)).toEqual(values.map((c) => c - 3))
    expect(Array.from(a.volume)).toEqual(values.map((_, i) => i))
    expect(Array.from(a.ema)).toEqual(Array.from(ema(values, 20)))
    expect(Array.from(a.rsi)).toEqual(Array.from(rsi(values, 14)))
    expect(Number.isNaN(a.ema[18])).toBe(true)
    expect(Number.isNaN(a.ema[19])).toBe(false)
    expect(Number.isNaN(a.rsi[14])).toBe(false)
  })
})
