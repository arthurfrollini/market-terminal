import type { CSSProperties } from 'react'
import { stepDecimals, type GroupedLevels } from '../domain/aggregate'
import { marketClient } from '../market/client'
import { useMarketStore } from '../market/store'
import { formatFixed, qtyDecimals } from '../ui/format'
import { useSymbolInfo } from '../ui/useSymbolInfo'

const ROWS = 14
const GROUPING_MULTIPLIERS = [1, 10, 100, 1000, 10000]

function formatBps(bps: number): string {
  return bps > 0 && bps < 0.01 ? '<0.01 bps' : `${bps.toFixed(2)} bps`
}

interface RowsProps {
  side: 'bid' | 'ask'
  levels: GroupedLevels
  maxTotal: number
  priceDecimals: number
  qtyDecimals: number
}

function Levels({ side, levels, maxTotal, priceDecimals, qtyDecimals }: RowsProps) {
  const n = Math.min(ROWS, levels.count)
  const rows = []
  for (let i = 0; i < n; i++) {
    const fill = maxTotal > 0 ? levels.totals[i] / maxTotal : 0
    rows.push(
      <div
        key={i}
        className={`level ${side}`}
        data-testid={`${side}-row`}
        style={{ '--fill': `${(fill * 100).toFixed(1)}%` } as CSSProperties}
      >
        <span className="level-price">{formatFixed(levels.prices[i], priceDecimals)}</span>
        <span className="level-qty">{formatFixed(levels.qtys[i], qtyDecimals)}</span>
        <span className="level-total">{formatFixed(levels.totals[i], qtyDecimals)}</span>
      </div>,
    )
  }
  // Asks read bottom-up so the best ask sits next to the spread.
  if (side === 'ask') rows.reverse()
  return <div className={`levels ${side}s`}>{rows}</div>
}

export function OrderBookPanel() {
  const info = useSymbolInfo()
  const book = useMarketStore((s) => s.book)
  const grouping = useMarketStore((s) => s.grouping) ?? info.tickSize
  const options = GROUPING_MULTIPLIERS.map((m) => Number((info.tickSize * m).toPrecision(12)))
  const priceDecimals = Math.min(info.priceDecimals, stepDecimals(grouping))
  const qd = qtyDecimals(info.qtyDecimals)

  const live = book?.status === 'live'
  const lastIndex = (l: GroupedLevels) => Math.min(ROWS, l.count) - 1
  const maxTotal = book
    ? Math.max(book.bids.totals[lastIndex(book.bids)] ?? 0, book.asks.totals[lastIndex(book.asks)] ?? 0)
    : 0

  return (
    <section className="book panel" aria-label="Order book" data-testid="order-book" data-status={book?.status ?? 'idle'}>
      <div className="panel-head">
        <h2 className="panel-title">Order book</h2>
        <label className="grouping">
          <span className="visually-hidden">Price grouping</span>
          <select
            value={grouping}
            onChange={(e) => marketClient.setGrouping(Number(e.target.value))}
            data-testid="grouping"
          >
            {options.map((step) => (
              <option key={step} value={step}>
                {formatFixed(step, stepDecimals(step))}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="level level-head" aria-hidden>
        <span>Price</span>
        <span>Size ({info.baseAsset || 'base'})</span>
        <span>Total</span>
      </div>
      {book && live ? (
        <>
          <Levels side="ask" levels={book.asks} maxTotal={maxTotal} priceDecimals={priceDecimals} qtyDecimals={qd} />
          <div className="spread" data-testid="spread">
            <span className="spread-mid">{book.mid !== null ? formatFixed(book.mid, info.priceDecimals + 1) : '—'}</span>
            <span className="spread-value">
              {book.spread !== null && book.mid
                ? `Spread ${formatFixed(book.spread, info.priceDecimals)} (${formatBps((book.spread / book.mid) * 10_000)})`
                : ''}
            </span>
          </div>
          <Levels side="bid" levels={book.bids} maxTotal={maxTotal} priceDecimals={priceDecimals} qtyDecimals={qd} />
        </>
      ) : (
        <p className="note book-syncing">Syncing order book</p>
      )}
    </section>
  )
}
