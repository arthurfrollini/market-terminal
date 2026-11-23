import { describe, expect, it } from 'vitest'
import type { DepthUpdateEvent, RawLevel } from './binance'
import { BookSide, OrderBook } from './orderBook'

function diff(U: number, u: number, b: RawLevel[] = [], a: RawLevel[] = []): DepthUpdateEvent {
  return { e: 'depthUpdate', E: 0, s: 'BTCUSDT', U, u, b, a }
}

const snapshot = (lastUpdateId: number) => ({
  lastUpdateId,
  bids: [['100.00', '1'], ['99.00', '2']] as RawLevel[],
  asks: [['101.00', '3'], ['102.00', '4']] as RawLevel[],
})

describe('BookSide', () => {
  it('keeps bids sorted high to low and asks low to high', () => {
    const bids = new BookSide(true)
    const asks = new BookSide(false)
    for (const p of [5, 1, 3, 4, 2]) {
      bids.set(p, 1)
      asks.set(p, 1)
    }
    expect(Array.from({ length: 5 }, (_, i) => bids.priceAt(i))).toEqual([5, 4, 3, 2, 1])
    expect(Array.from({ length: 5 }, (_, i) => asks.priceAt(i))).toEqual([1, 2, 3, 4, 5])
  })

  it('updates in place and removes a level when qty is zero', () => {
    const side = new BookSide(true)
    side.set(10, 1)
    side.set(11, 2)
    side.set(10, 5)
    expect(side.size).toBe(2)
    expect(side.qtyAt(10)).toBe(5)
    side.set(11, 0)
    expect(side.size).toBe(1)
    expect(side.best()).toBe(10)
  })

  it('ignores deletes for levels it never had', () => {
    const side = new BookSide(false)
    side.set(1, 0)
    expect(side.size).toBe(0)
  })
})

describe('OrderBook sync', () => {
  it('ignores diffs until a resync starts', () => {
    const book = new OrderBook()
    expect(book.applyDiff(diff(1, 2, [['1', '1']]))).toEqual({ ok: true })
    expect(book.bids.size).toBe(0)
  })

  it('buffers diffs, drops the ones the snapshot already has, applies the rest', () => {
    const book = new OrderBook()
    book.reset()
    book.applyDiff(diff(95, 99, [['100.00', '9']])) // already in snapshot
    book.applyDiff(diff(100, 102, [['100.00', '7']])) // straddles lastUpdateId + 1
    book.applyDiff(diff(103, 104, [], [['101.00', '0']]))
    expect(book.state).toBe('buffering')

    expect(book.applySnapshot(snapshot(100))).toEqual({ ok: true })
    expect(book.state).toBe('live')
    expect(book.lastUpdateId).toBe(104)
    expect(book.bids.qtyAt(100)).toBe(7)
    expect(book.asks.best()).toBe(102)
  })

  it('asks for a newer snapshot when it is older than the buffered diffs', () => {
    const book = new OrderBook()
    book.reset()
    book.applyDiff(diff(110, 112))
    expect(book.applySnapshot(snapshot(100))).toEqual({ ok: false, reason: 'stale-snapshot' })
    expect(book.state).toBe('buffering')
    // The buffered diff is kept, so a fresh snapshot can still use it.
    expect(book.applySnapshot(snapshot(111))).toEqual({ ok: true })
    expect(book.lastUpdateId).toBe(112)
  })

  it('applies contiguous diffs once live and skips stale ones', () => {
    const book = new OrderBook()
    book.reset()
    book.applySnapshot(snapshot(100))
    expect(book.applyDiff(diff(101, 101, [['100.50', '1']]))).toEqual({ ok: true })
    expect(book.applyDiff(diff(90, 101, [['100.50', '99']]))).toEqual({ ok: true })
    expect(book.bids.best()).toBe(100.5)
    expect(book.bids.qtyAt(100.5)).toBe(1)
  })

  it('detects a gap, clears the book and starts buffering again', () => {
    const book = new OrderBook()
    book.reset()
    book.applySnapshot(snapshot(100))
    expect(book.applyDiff(diff(105, 106))).toEqual({ ok: false, reason: 'gap' })
    expect(book.state).toBe('buffering')
    expect(book.bids.size).toBe(0)
    // The diffs that follow are buffered for the next snapshot.
    book.applyDiff(diff(107, 108))
    expect(book.bufferedCount).toBe(1)
  })
})
