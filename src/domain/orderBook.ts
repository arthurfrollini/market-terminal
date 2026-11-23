import type { DepthSnapshot, DepthUpdateEvent, RawLevel } from './binance'

/**
 * One side of the book: prices kept sorted best-first plus a price → qty map.
 * Diff events touch few levels, so binary search + splice beats re-sorting a Map every frame.
 */
export class BookSide {
  readonly descending: boolean
  private readonly prices: number[] = []
  private readonly qty = new Map<number, number>()

  constructor(descending: boolean) {
    this.descending = descending
  }

  get size(): number {
    return this.prices.length
  }

  clear(): void {
    this.prices.length = 0
    this.qty.clear()
  }

  best(): number | undefined {
    return this.prices[0]
  }

  priceAt(i: number): number {
    return this.prices[i]
  }

  qtyAt(price: number): number {
    return this.qty.get(price) ?? 0
  }

  set(price: number, qty: number): void {
    const exists = this.qty.has(price)
    if (qty === 0) {
      if (!exists) return
      this.qty.delete(price)
      this.prices.splice(this.search(price), 1)
      return
    }
    if (!exists) this.prices.splice(this.search(price), 0, price)
    this.qty.set(price, qty)
  }

  applyRaw(levels: RawLevel[]): void {
    for (const [p, q] of levels) this.set(Number(p), Number(q))
  }

  /** Index of `price` if present, otherwise the index where it would be inserted. */
  private search(price: number): number {
    const { prices, descending } = this
    let lo = 0
    let hi = prices.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      const p = prices[mid]
      if (p === price) return mid
      if (descending ? p > price : p < price) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}

export type BookSyncState = 'idle' | 'buffering' | 'live'

export type ResyncReason = 'initial' | 'gap' | 'stale-snapshot'

export type SyncResult = { ok: true } | { ok: false; reason: ResyncReason }

const OK: SyncResult = { ok: true }
const MAX_BUFFERED_EVENTS = 5_000

/**
 * Local order book kept in sync with Binance's diff stream:
 * buffer diffs → fetch REST snapshot → drop diffs already in the snapshot → apply the rest,
 * checking that update ids stay contiguous. Any gap means the book is wrong and must resync.
 */
export class OrderBook {
  readonly bids = new BookSide(true)
  readonly asks = new BookSide(false)
  state: BookSyncState = 'idle'
  lastUpdateId = 0
  private buffer: DepthUpdateEvent[] = []

  /** Drops all levels and starts buffering diffs until a snapshot arrives. */
  reset(): void {
    this.bids.clear()
    this.asks.clear()
    this.buffer = []
    this.lastUpdateId = 0
    this.state = 'buffering'
  }

  get bufferedCount(): number {
    return this.buffer.length
  }

  applyDiff(ev: DepthUpdateEvent): SyncResult {
    if (this.state === 'idle') return OK
    if (this.state === 'buffering') {
      this.buffer.push(ev)
      // Snapshot is late; the oldest diffs will be older than it anyway.
      if (this.buffer.length > MAX_BUFFERED_EVENTS) this.buffer.shift()
      return OK
    }
    if (ev.u <= this.lastUpdateId) return OK
    if (ev.U > this.lastUpdateId + 1) {
      this.reset()
      return { ok: false, reason: 'gap' }
    }
    this.bids.applyRaw(ev.b)
    this.asks.applyRaw(ev.a)
    this.lastUpdateId = ev.u
    return OK
  }

  applySnapshot(snap: DepthSnapshot): SyncResult {
    const pending = this.buffer.filter((e) => e.u > snap.lastUpdateId)
    // Diffs between the snapshot and the first buffered event were missed: need a newer snapshot.
    if (pending.length > 0 && pending[0].U > snap.lastUpdateId + 1) {
      this.buffer = pending
      return { ok: false, reason: 'stale-snapshot' }
    }
    this.bids.clear()
    this.asks.clear()
    this.bids.applyRaw(snap.bids)
    this.asks.applyRaw(snap.asks)
    this.lastUpdateId = snap.lastUpdateId
    this.buffer = []
    this.state = 'live'
    for (const ev of pending) {
      const r = this.applyDiff(ev)
      if (!r.ok) return r
    }
    return OK
  }
}
