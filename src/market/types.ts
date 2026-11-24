import type { DepthCurve, GroupedLevels } from '../domain/aggregate'
import type { DepthSnapshot } from '../domain/binance'
import type { Candle, CandleArrays, Interval } from '../domain/candles'
import type { BookSyncState, ResyncReason } from '../domain/orderBook'

export type Side = 'buy' | 'sell'

export interface Trade {
  id: number
  price: number
  qty: number
  time: number
  /** Aggressor side. */
  side: Side
}

export interface Ticker {
  symbol: string
  last: number
  open: number
  high: number
  low: number
  baseVolume: number
  quoteVolume: number
  changePct: number
}

export interface BookFrame {
  symbol: string
  status: BookSyncState
  lastUpdateId: number
  bestBid: number | null
  bestAsk: number | null
  mid: number | null
  spread: number | null
  grouping: number
  bids: GroupedLevels
  asks: GroupedLevels
  depth: { bids: DepthCurve; asks: DepthCurve; rangePct: number }
}

export interface CandleFrame extends CandleArrays {
  symbol: string
  interval: Interval
}

export interface MarketStats {
  msgsPerSec: number
  tradesPerSec: number
  /** Share of aggressive buy volume over the last 60s, 0..1. */
  buyShare: number | null
  vwap: number | null
  /** Top-10-level book imbalance, −1..1. */
  imbalance: number
  /** Fraction of the last second the worker spent processing messages. */
  workerLoad: number
  /** Exchange timestamp of the newest event, ms since epoch. */
  lastEventTime: number
}

export interface WorkerFrame {
  seq: number
  symbol: string
  /** Epoch ms when the worker posted the frame. */
  sentAt: number
  /** Null when the book has not changed since the last frame. */
  book: BookFrame | null
  trades: Trade[]
  ticker: Ticker | null
  /** Null when the candles have not changed since the last frame. */
  candles: CandleFrame | null
  stats: MarketStats
}

export type FeedSource = 'binance' | 'synthetic'

export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface ConnStatus {
  state: ConnState
  attempt: number
  retryInMs: number | null
  source: FeedSource
}

export type ToWorker =
  | { type: 'start'; symbol: string; wsBase: string; grouping: number; tickSize: number; interval: Interval }
  | { type: 'snapshot'; symbol: string; snapshot: DepthSnapshot }
  | { type: 'interval'; interval: Interval }
  | { type: 'history'; symbol: string; interval: Interval; candles: Candle[] }
  | { type: 'grouping'; step: number }
  | { type: 'stress'; enabled: boolean; messagesPerSecond: number }
  | { type: 'pull' }
  | { type: 'drop' }

export type FromWorker =
  | { type: 'status'; status: ConnStatus }
  | { type: 'need-snapshot'; symbol: string; reason: ResyncReason }
  | { type: 'need-history'; symbol: string; interval: Interval }
  | { type: 'frame'; frame: WorkerFrame | null }
