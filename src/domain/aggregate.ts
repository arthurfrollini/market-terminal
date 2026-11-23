import type { BookSide } from './orderBook'

/** Decimal places of a power-of-ten step (0.01 → 2, 1 → 0, 10 → 0). */
export function stepDecimals(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

export interface GroupedLevels {
  prices: Float64Array
  qtys: Float64Array
  /** Running total from the best level outwards. */
  totals: Float64Array
  count: number
}

/**
 * Buckets levels into price groups of `step`, best-first, stopping at `maxGroups`.
 * Bids round down and asks round up so a group never crosses the spread.
 */
export function groupLevels(side: BookSide, step: number, maxGroups: number): GroupedLevels {
  const prices = new Float64Array(maxGroups)
  const qtys = new Float64Array(maxGroups)
  const totals = new Float64Array(maxGroups)
  const decimals = stepDecimals(step)
  let count = 0
  let current = Number.NaN
  let total = 0

  for (let i = 0; i < side.size; i++) {
    const price = side.priceAt(i)
    const ratio = price / step
    const key = roundTo(
      (side.descending ? Math.floor(ratio + 1e-9) : Math.ceil(ratio - 1e-9)) * step,
      decimals,
    )
    const qty = side.qtyAt(price)
    if (key !== current) {
      if (count === maxGroups) break
      current = key
      prices[count] = key
      count++
    }
    qtys[count - 1] += qty
    total += qty
    totals[count - 1] = total
  }
  return { prices, qtys, totals, count }
}

export interface DepthCurve {
  /** Bucket edge prices moving away from mid. */
  prices: Float64Array
  /** Cumulative base qty from mid up to each edge. */
  cumulative: Float64Array
}

/**
 * Cumulative depth sampled at `buckets` evenly spaced prices between mid and mid ± rangePct.
 * Fixed-size output keeps the canvas draw cost constant no matter how deep the book is.
 */
export function depthCurve(side: BookSide, mid: number, rangePct: number, buckets: number): DepthCurve {
  const prices = new Float64Array(buckets)
  const cumulative = new Float64Array(buckets)
  const width = (mid * rangePct) / buckets
  const dir = side.descending ? -1 : 1
  for (let b = 0; b < buckets; b++) prices[b] = mid + dir * width * (b + 1)

  let total = 0
  let bucket = 0
  for (let i = 0; i < side.size && bucket < buckets; i++) {
    const price = side.priceAt(i)
    const distance = Math.abs(price - mid)
    while (bucket < buckets && distance > width * (bucket + 1)) {
      cumulative[bucket] = total
      bucket++
    }
    if (bucket === buckets) break
    total += side.qtyAt(price)
  }
  for (; bucket < buckets; bucket++) cumulative[bucket] = total
  return { prices, cumulative }
}
