/**
 * Sum over a sliding time window using fixed buckets: O(1) add, O(buckets) read,
 * no per-event allocation. Good enough resolution for rates shown to a human.
 */
export class RollingSum {
  private readonly bucketMs: number
  private readonly values: Float64Array
  private readonly epochs: Float64Array

  constructor(windowMs: number, buckets: number) {
    this.bucketMs = windowMs / buckets
    this.values = new Float64Array(buckets)
    this.epochs = new Float64Array(buckets).fill(-1)
  }

  get windowMs(): number {
    return this.bucketMs * this.values.length
  }

  add(value: number, now: number): void {
    const epoch = Math.floor(now / this.bucketMs)
    const slot = epoch % this.values.length
    if (this.epochs[slot] !== epoch) {
      this.epochs[slot] = epoch
      this.values[slot] = 0
    }
    this.values[slot] += value
  }

  sum(now: number): number {
    const epoch = Math.floor(now / this.bucketMs)
    const n = this.values.length
    let total = 0
    for (let i = 0; i < n; i++) {
      const age = epoch - this.epochs[i]
      if (this.epochs[i] >= 0 && age >= 0 && age < n) total += this.values[i]
    }
    return total
  }

  /** Events (or units) per second over the window. */
  rate(now: number): number {
    return this.sum(now) / (this.windowMs / 1000)
  }

  clear(): void {
    this.values.fill(0)
    this.epochs.fill(-1)
  }
}

/** Volume-weighted average price since the last reset. */
export class Vwap {
  private notional = 0
  private volume = 0

  add(price: number, qty: number): void {
    this.notional += price * qty
    this.volume += qty
  }

  get value(): number | null {
    return this.volume > 0 ? this.notional / this.volume : null
  }

  clear(): void {
    this.notional = 0
    this.volume = 0
  }
}

/** (bid − ask) / (bid + ask) over the given quantities: +1 all bids, −1 all asks. */
export function imbalance(bidQty: number, askQty: number): number {
  const total = bidQty + askQty
  return total > 0 ? (bidQty - askQty) / total : 0
}
