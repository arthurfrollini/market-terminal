import { useQuery } from '@tanstack/react-query'
import { tickers24hQuery } from '../api/binance'
import { SYMBOLS } from '../config'
import { marketClient } from '../market/client'
import { useMarketStore } from '../market/store'
import { formatPct } from '../ui/format'

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (price >= 1) return price.toFixed(price >= 100 ? 2 : 3)
  return price.toPrecision(4)
}

export function MarketList() {
  const selected = useMarketStore((s) => s.symbol)
  const { data, isPending, isError } = useQuery(tickers24hQuery(SYMBOLS))

  return (
    <nav className="markets panel" aria-label="Markets">
      <h2 className="panel-title">Markets</h2>
      {isError && !data && <p className="note">Prices unavailable. Retrying every 10 seconds.</p>}
      <ul>
        {SYMBOLS.map((symbol) => {
          const row = data?.find((r) => r.symbol === symbol)
          const base = symbol.replace(/USDT$/, '')
          return (
            <li key={symbol}>
              <button
                type="button"
                className="market"
                aria-current={symbol === selected ? 'true' : undefined}
                data-testid={`market-${symbol}`}
                onClick={() => marketClient.selectSymbol(symbol)}
              >
                <span className="market-base">{base}</span>
                <span className="market-price">{row ? formatPrice(row.last) : isPending ? '…' : '—'}</span>
                <span className={`market-change ${row && row.changePct < 0 ? 'down' : 'up'}`}>
                  {row ? formatPct(row.changePct) : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
