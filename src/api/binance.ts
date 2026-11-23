import { QueryClient, queryOptions } from '@tanstack/react-query'
import { REST_BASE, SNAPSHOT_LIMIT } from '../config'
import { stepDecimals } from '../domain/aggregate'
import type { DepthSnapshot } from '../domain/binance'

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${REST_BASE}${path}`, { signal })
  if (!res.ok) throw new HttpError(res.status, `GET ${path} failed with ${res.status}`)
  return res.json() as Promise<T>
}

/** Retry server errors and rate limits; a 400 (bad symbol) won't fix itself. */
export function retryable(failureCount: number, error: Error): boolean {
  if (error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429) return false
  return failureCount < 3
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: retryable, refetchOnWindowFocus: false } },
})

interface RawTicker24h {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  quoteVolume: string
}

export interface MarketSummary {
  symbol: string
  last: number
  changePct: number
  quoteVolume: number
}

export const tickers24hQuery = (symbols: readonly string[]) =>
  queryOptions({
    queryKey: ['tickers24h', symbols],
    queryFn: ({ signal }) =>
      getJson<RawTicker24h[]>(`/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`, signal),
    select: (rows): MarketSummary[] =>
      rows.map((r) => ({
        symbol: r.symbol,
        last: Number(r.lastPrice),
        changePct: Number(r.priceChangePercent),
        quoteVolume: Number(r.quoteVolume),
      })),
    refetchInterval: 10_000,
    placeholderData: (prev) => prev,
  })

interface RawExchangeInfo {
  symbols: {
    symbol: string
    baseAsset: string
    quoteAsset: string
    filters: { filterType: string; tickSize?: string; stepSize?: string }[]
  }[]
}

export interface SymbolInfo {
  symbol: string
  baseAsset: string
  quoteAsset: string
  tickSize: number
  stepSize: number
  priceDecimals: number
  qtyDecimals: number
}

export const symbolInfoQuery = (symbol: string) =>
  queryOptions({
    queryKey: ['symbolInfo', symbol],
    queryFn: async ({ signal }): Promise<SymbolInfo> => {
      const info = await getJson<RawExchangeInfo>(`/api/v3/exchangeInfo?symbol=${symbol}`, signal)
      const s = info.symbols[0]
      const tickSize = Number(s.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize ?? '0.01')
      const stepSize = Number(s.filters.find((f) => f.filterType === 'LOT_SIZE')?.stepSize ?? '0.00001')
      return {
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        tickSize,
        stepSize,
        priceDecimals: stepDecimals(tickSize),
        qtyDecimals: stepDecimals(stepSize),
      }
    },
    staleTime: Infinity,
  })

/** Never cached: a snapshot is only useful against the diffs buffered right now. */
export const depthSnapshotQuery = (symbol: string) =>
  queryOptions({
    queryKey: ['depthSnapshot', symbol],
    queryFn: ({ signal }) => getJson<DepthSnapshot>(`/api/v3/depth?symbol=${symbol}&limit=${SNAPSHOT_LIMIT}`, signal),
    staleTime: 0,
    gcTime: 0,
  })
