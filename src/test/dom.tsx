// Shared setup for component tests (jsdom). Importing it registers cleanup and browser stubs.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'
import { symbolInfoQuery, type SymbolInfo } from '../api/binance'
import type { GroupedLevels } from '../domain/aggregate'
import { initialMarketState, tradeTape, useMarketStore } from '../market/store'
import type { BookFrame, Trade } from '../market/types'

export const BTC: SymbolInfo = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  tickSize: 0.01,
  stepSize: 0.00001,
  priceDecimals: 2,
  qtyDecimals: 5,
}

/** jsdom has no ResizeObserver; tests call `resize()` to report a size. */
export class FakeResizeObserver {
  static all: FakeResizeObserver[] = []
  readonly cb: ResizeObserverCallback
  targets: Element[] = []
  disconnected = false

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
    FakeResizeObserver.all.push(this)
  }
  observe(el: Element) {
    this.targets.push(el)
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
  resize(width: number, height: number) {
    const entries = this.targets.map((target) => ({ target, contentRect: { width, height } }))
    this.cb(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver)
  }
}

let rafQueue = new Map<number, FrameRequestCallback>()
let rafId = 0
/** Runs the callbacks queued for the next animation frame. */
export function animationFrame(now = 0) {
  const queue = rafQueue
  rafQueue = new Map()
  for (const cb of queue.values()) cb(now)
}
export const pendingFrames = () => rafQueue.size

beforeEach(() => {
  useMarketStore.setState(initialMarketState('BTCUSDT'), true)
  tradeTape.clear()
  FakeResizeObserver.all = []
  rafQueue = new Map()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.set(++rafId, cb)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => rafQueue.delete(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Makes every canvas return a 2D context that records the text drawn (and where) and the path calls;
 * every other call is a no-op.
 */
export function fakeCanvasContext() {
  const texts: string[] = []
  const placed: { text: string; x: number; y: number }[] = []
  const calls: string[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'fillText') {
        return (text: string, x: number, y: number) => {
          texts.push(text)
          placed.push({ text, x, y })
        }
      }
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 })
      return () => calls.push(String(key))
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  return { texts, placed, calls, clear: () => { texts.length = 0; placed.length = 0; calls.length = 0 } }
}

export function renderWithMarket(ui: ReactElement, { info = BTC as SymbolInfo | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (info) client.setQueryData(symbolInfoQuery(info.symbol).queryKey, info)
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) }
}

function levels(rows: [price: number, qty: number][]): GroupedLevels {
  let total = 0
  const totals = rows.map(([, q]) => (total += q))
  return {
    prices: Float64Array.from(rows.map(([p]) => p)),
    qtys: Float64Array.from(rows.map(([, q]) => q)),
    totals: Float64Array.from(totals),
    count: rows.length,
  }
}

/** A live book with best levels first on each side. */
export function liveBook(bids: [number, number][], asks: [number, number][], over: Partial<BookFrame> = {}): BookFrame {
  const bestBid = bids[0]?.[0] ?? null
  const bestAsk = asks[0]?.[0] ?? null
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null
  const curve = (side: [number, number][]) => {
    const l = levels(side)
    return { prices: l.prices, cumulative: l.totals }
  }
  return {
    symbol: 'BTCUSDT',
    status: 'live',
    lastUpdateId: 1,
    bestBid,
    bestAsk,
    mid,
    spread: mid !== null ? bestAsk! - bestBid! : null,
    grouping: 0.01,
    bids: levels(bids),
    asks: levels(asks),
    depth: { bids: curve(bids), asks: curve(asks), rangePct: 0.005 },
    ...over,
  }
}

export const trade = (id: number, over: Partial<Trade> = {}): Trade => ({
  id,
  price: 61_236.01,
  qty: 0.0025,
  time: new Date(2026, 10, 23, 9, 41, 0, id % 1000).getTime(),
  side: 'buy',
  ...over,
})
