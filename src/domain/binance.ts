// Wire types for Binance spot market-data streams and REST endpoints.
// https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams

export type RawLevel = [price: string, qty: string]

export interface DepthUpdateEvent {
  e: 'depthUpdate'
  E: number
  s: string
  /** First update id in this event. */
  U: number
  /** Final update id in this event. */
  u: number
  b: RawLevel[]
  a: RawLevel[]
}

export interface TradeEvent {
  e: 'trade'
  E: number
  s: string
  t: number
  p: string
  q: string
  T: number
  /** Buyer is the maker, i.e. the aggressor sold. */
  m: boolean
}

export interface MiniTickerEvent {
  e: '24hrMiniTicker'
  E: number
  s: string
  c: string
  o: string
  h: string
  l: string
  v: string
  q: string
}

export type StreamEvent = DepthUpdateEvent | TradeEvent | MiniTickerEvent

export interface DepthSnapshot {
  lastUpdateId: number
  bids: RawLevel[]
  asks: RawLevel[]
}

export function streamUrl(wsBase: string, symbol: string): string {
  const s = symbol.toLowerCase()
  return `${wsBase}/stream?streams=${s}@depth@100ms/${s}@trade/${s}@miniTicker`
}

/** Parses a combined-stream frame (`{ stream, data }`). Returns null for anything else. */
export function parseStreamMessage(text: string): StreamEvent | null {
  let msg: unknown
  try {
    msg = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof msg !== 'object' || msg === null || !('data' in msg)) return null
  const data = (msg as { data: unknown }).data
  if (typeof data !== 'object' || data === null || !('e' in data)) return null
  const e = (data as { e: unknown }).e
  if (e === 'depthUpdate' || e === 'trade' || e === '24hrMiniTicker') return data as StreamEvent
  return null
}
