import { useShallow } from 'zustand/react/shallow'
import { useMarketStore } from '../market/store'
import type { ConnStatus } from '../market/types'
import { formatCompact, formatFixed, formatPct } from '../ui/format'
import { useSymbolInfo } from '../ui/useSymbolInfo'

function connLabel(conn: ConnStatus): string {
  if (conn.source === 'synthetic') return 'Simulated feed'
  switch (conn.state) {
    case 'open':
      return 'Live'
    case 'connecting':
      return 'Connecting'
    case 'reconnecting':
      return conn.retryInMs !== null
        ? `Reconnecting in ${(conn.retryInMs / 1000).toFixed(1)}s (attempt ${conn.attempt})`
        : `Reconnecting (attempt ${conn.attempt})`
    case 'closed':
      return 'Disconnected'
    default:
      return 'Waiting'
  }
}

function ConnectionPill() {
  const conn = useMarketStore((s) => s.conn)
  return (
    <div className="conn" data-testid="conn" data-state={conn.state} data-source={conn.source} role="status">
      <span className="conn-dot" aria-hidden />
      {connLabel(conn)}
    </div>
  )
}

function LastPrice({ decimals }: { decimals: number }) {
  // Only the fields shown here; a new trade elsewhere doesn't re-render the header.
  const { last, changePct } = useMarketStore(
    useShallow((s) => ({ last: s.ticker?.last ?? null, changePct: s.ticker?.changePct ?? null })),
  )
  const dir = changePct === null ? '' : changePct >= 0 ? 'up' : 'down'
  return (
    <div className={`last ${dir}`}>
      <span className="last-price" data-testid="last-price">
        {last !== null ? formatFixed(last, decimals) : '—'}
      </span>
      <span className="last-change">{changePct !== null ? formatPct(changePct) : ''}</span>
    </div>
  )
}

function DayStats({ decimals, quote }: { decimals: number; quote: string }) {
  const { high, low, quoteVolume } = useMarketStore(
    useShallow((s) => ({
      high: s.ticker?.high ?? null,
      low: s.ticker?.low ?? null,
      quoteVolume: s.ticker?.quoteVolume ?? null,
    })),
  )
  const show = (v: number | null) => (v !== null ? formatFixed(v, decimals) : '—')
  return (
    <dl className="day-stats">
      <div>
        <dt>24h high</dt>
        <dd>{show(high)}</dd>
      </div>
      <div>
        <dt>24h low</dt>
        <dd>{show(low)}</dd>
      </div>
      <div>
        <dt>24h volume</dt>
        <dd>{quoteVolume !== null ? `${formatCompact(quoteVolume)} ${quote}` : '—'}</dd>
      </div>
    </dl>
  )
}

export function TopBar() {
  const info = useSymbolInfo()
  const symbol = useMarketStore((s) => s.symbol)
  return (
    <header className="topbar">
      <div className="pair">
        <h1 data-testid="symbol">
          {info.baseAsset ? (
            <>
              {info.baseAsset}
              <span className="pair-quote">/{info.quoteAsset}</span>
            </>
          ) : (
            symbol
          )}
        </h1>
        <LastPrice decimals={info.priceDecimals} />
      </div>
      <DayStats decimals={info.priceDecimals} quote={info.quoteAsset} />
      <ConnectionPill />
    </header>
  )
}
