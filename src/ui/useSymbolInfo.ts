import { useQuery } from '@tanstack/react-query'
import { symbolInfoQuery, type SymbolInfo } from '../api/binance'
import { useMarketStore } from '../market/store'

const FALLBACK: SymbolInfo = {
  symbol: '',
  baseAsset: '',
  quoteAsset: '',
  tickSize: 0.01,
  stepSize: 0.00001,
  priceDecimals: 2,
  qtyDecimals: 5,
}

/** Precision info for the selected symbol. Cached forever, so every caller shares one request. */
export function useSymbolInfo(): SymbolInfo {
  const symbol = useMarketStore((s) => s.symbol)
  const { data } = useQuery(symbolInfoQuery(symbol))
  return data ?? { ...FALLBACK, symbol }
}
