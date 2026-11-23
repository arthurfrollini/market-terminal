import { describe, expect, it } from 'vitest'
import { RollingSum, Vwap, imbalance } from './indicators'
import { RingBuffer } from './ringBuffer'

describe('RollingSum', () => {
  it('sums values inside the window and forgets older ones', () => {
    const r = new RollingSum(1000, 10)
    r.add(1, 0)
    r.add(2, 450)
    r.add(3, 990)
    expect(r.sum(990)).toBe(6)
    expect(r.rate(990)).toBe(6)
    // At 1050 the 0–99ms bucket has expired.
    expect(r.sum(1050)).toBe(5)
    expect(r.sum(5000)).toBe(0)
  })

  it('reuses a slot once its bucket has expired', () => {
    const r = new RollingSum(1000, 10)
    r.add(5, 10)
    r.add(1, 1010) // same slot, next lap
    expect(r.sum(1010)).toBe(1)
  })
})

describe('Vwap', () => {
  it('weights price by quantity', () => {
    const v = new Vwap()
    expect(v.value).toBeNull()
    v.add(100, 1)
    v.add(110, 3)
    expect(v.value).toBe(107.5)
  })
})

describe('imbalance', () => {
  it('ranges from −1 (all asks) to +1 (all bids)', () => {
    expect(imbalance(1, 0)).toBe(1)
    expect(imbalance(0, 1)).toBe(-1)
    expect(imbalance(3, 1)).toBe(0.5)
    expect(imbalance(0, 0)).toBe(0)
  })
})

describe('RingBuffer', () => {
  it('returns newest first and overwrites the oldest past capacity', () => {
    const r = new RingBuffer<number>(3)
    r.pushMany([1, 2, 3, 4])
    expect(r.length).toBe(3)
    expect([r.at(0), r.at(1), r.at(2), r.at(3)]).toEqual([4, 3, 2, undefined])
  })

  it('only keeps the tail of a batch larger than its capacity', () => {
    const r = new RingBuffer<number>(2)
    r.pushMany([1, 2, 3, 4, 5])
    expect([r.at(0), r.at(1)]).toEqual([5, 4])
    r.clear()
    expect(r.length).toBe(0)
  })
})
