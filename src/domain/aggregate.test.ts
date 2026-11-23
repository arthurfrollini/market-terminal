import { describe, expect, it } from 'vitest'
import { depthCurve, groupLevels, stepDecimals } from './aggregate'
import { BookSide } from './orderBook'

function side(descending: boolean, levels: [number, number][]): BookSide {
  const s = new BookSide(descending)
  for (const [p, q] of levels) s.set(p, q)
  return s
}

describe('stepDecimals', () => {
  it('counts decimals of power-of-ten steps', () => {
    expect(stepDecimals(0.01)).toBe(2)
    expect(stepDecimals(0.00000001)).toBe(8)
    expect(stepDecimals(1)).toBe(0)
    expect(stepDecimals(100)).toBe(0)
  })
})

describe('groupLevels', () => {
  it('floors bids and ceils asks so groups never cross the spread', () => {
    const bids = side(true, [[100.07, 1], [100.03, 2], [99.98, 4]])
    const asks = side(false, [[100.11, 1], [100.19, 2], [100.21, 4]])
    const b = groupLevels(bids, 0.1, 10)
    const a = groupLevels(asks, 0.1, 10)
    expect(Array.from(b.prices.subarray(0, b.count))).toEqual([100, 99.9])
    expect(Array.from(b.qtys.subarray(0, b.count))).toEqual([3, 4])
    expect(Array.from(a.prices.subarray(0, a.count))).toEqual([100.2, 100.3])
    expect(Array.from(a.qtys.subarray(0, a.count))).toEqual([3, 4])
  })

  it('accumulates totals and stops at maxGroups', () => {
    const bids = side(true, [[5, 1], [4, 1], [3, 1], [2, 1]])
    const g = groupLevels(bids, 1, 3)
    expect(g.count).toBe(3)
    expect(Array.from(g.totals)).toEqual([1, 2, 3])
  })

  it('handles float steps without drift (0.1 * 3 is not 0.3 in IEEE 754)', () => {
    const bids = side(true, [[0.3, 1]])
    expect(groupLevels(bids, 0.1, 1).prices[0]).toBe(0.3)
  })
})

describe('depthCurve', () => {
  it('produces a non-decreasing cumulative curve moving away from mid', () => {
    const bids = side(true, [[99.9, 1], [99.5, 2], [99.1, 3], [90, 100]])
    const curve = depthCurve(bids, 100, 0.01, 10)
    expect(curve.prices[0]).toBeCloseTo(99.9)
    expect(curve.prices[9]).toBeCloseTo(99)
    expect(curve.cumulative[0]).toBe(1)
    expect(curve.cumulative[4]).toBe(3)
    expect(curve.cumulative[9]).toBe(6) // the level at 90 is outside the 1% range
    for (let i = 1; i < 10; i++) expect(curve.cumulative[i]).toBeGreaterThanOrEqual(curve.cumulative[i - 1])
  })

  it('is flat for an empty side', () => {
    const curve = depthCurve(new BookSide(false), 100, 0.01, 4)
    expect(Array.from(curve.cumulative)).toEqual([0, 0, 0, 0])
  })
})
