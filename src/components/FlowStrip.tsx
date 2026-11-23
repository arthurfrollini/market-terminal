import type { CSSProperties } from 'react'
import { useMarketStore } from '../market/store'
import { formatFixed } from '../ui/format'
import { useSymbolInfo } from '../ui/useSymbolInfo'

/** Indicators computed in the worker; each cell subscribes to its own field. */
export function FlowStrip() {
  const info = useSymbolInfo()
  const vwap = useMarketStore((s) => s.stats.vwap)
  const buyShare = useMarketStore((s) => s.stats.buyShare)
  const imbalance = useMarketStore((s) => s.stats.imbalance)
  const hasBook = useMarketStore((s) => s.book?.status === 'live')

  return (
    <section className="flow" aria-label="Order flow">
      <div className="flow-cell">
        <span className="flow-label">VWAP since open</span>
        <span className="flow-value" data-testid="vwap">
          {vwap !== null ? formatFixed(vwap, info.priceDecimals) : '—'}
        </span>
      </div>
      <div className="flow-cell">
        <span className="flow-label">Buy volume, last 60s</span>
        <span className="flow-value">{buyShare !== null ? `${(buyShare * 100).toFixed(1)}%` : '—'}</span>
        <span className="meter" aria-hidden style={{ '--value': buyShare ?? 0.5 } as CSSProperties} />
      </div>
      <div className="flow-cell">
        <span className="flow-label">Book imbalance, top 10</span>
        <span className="flow-value">{hasBook ? `${imbalance > 0 ? '+' : ''}${(imbalance * 100).toFixed(1)}%` : '—'}</span>
        <span className="meter diverging" aria-hidden style={{ '--value': (imbalance + 1) / 2 } as CSSProperties} />
      </div>
    </section>
  )
}
