import { create } from 'zustand'
import { DEFAULT_SYMBOL, ENGINE_THREAD, START_IN_STRESS, TRADE_TAPE_CAPACITY } from '../config'
import type { Interval } from '../domain/candles'
import type { ResyncReason } from '../domain/orderBook'
import { RingBuffer } from '../domain/ringBuffer'
import type { BookFrame, CandleFrame, ConnStatus, MarketStats, Ticker, Trade } from './types'

/**
 * Trades live outside React state: copying a 10k-item array on every frame would cost more
 * than rendering the ~30 visible rows. The store only carries counters that say "something changed".
 */
export const tradeTape = new RingBuffer<Trade>(TRADE_TAPE_CAPACITY)

export const EMPTY_STATS: MarketStats = {
  msgsPerSec: 0,
  tradesPerSec: 0,
  buyShare: null,
  vwap: null,
  imbalance: 0,
  workerLoad: 0,
  lastEventTime: 0,
}

export type ChartView = 'price' | 'depth'

export interface MarketState {
  symbol: string
  conn: ConnStatus
  book: BookFrame | null
  ticker: Ticker | null
  candles: CandleFrame | null
  interval: Interval
  chartView: ChartView
  stats: MarketStats
  /** Trades received since the symbol was selected; the tape keeps the newest 10k. */
  tradesTotal: number
  /** Null until the user picks one; the symbol's tick size is used meanwhile. */
  grouping: number | null
  stress: boolean
  stressRate: number
  resyncs: number
  lastResync: ResyncReason | null
  fps: number
  /** Wall-clock gap between the newest exchange event and the frame reaching the UI. */
  eventLagMs: number | null
  /** Where the engine runs; `main` only with `?engine=main`. */
  engineThread: 'worker' | 'main'
}

export const initialMarketState = (symbol = DEFAULT_SYMBOL): MarketState => ({
  symbol,
  conn: { state: 'idle', attempt: 0, retryInMs: null, source: START_IN_STRESS ? 'synthetic' : 'binance' },
  book: null,
  ticker: null,
  candles: null,
  interval: '1m',
  chartView: 'price',
  stats: EMPTY_STATS,
  tradesTotal: 0,
  grouping: null,
  stress: START_IN_STRESS,
  stressRate: 5_000,
  resyncs: 0,
  lastResync: null,
  fps: 0,
  eventLagMs: null,
  engineThread: ENGINE_THREAD,
})

export const useMarketStore = create<MarketState>()(() => initialMarketState())
