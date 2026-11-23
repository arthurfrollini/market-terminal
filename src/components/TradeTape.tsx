import { useVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, useState } from 'react'
import { tradeTape, useMarketStore } from '../market/store'
import { formatFixed, formatTime, qtyDecimals } from '../ui/format'
import { useSymbolInfo } from '../ui/useSymbolInfo'

const ROW_HEIGHT = 24

/**
 * Up to 10k trades, ~30 in the DOM. Newest is on top; when the reader scrolls down, the view stays
 * pinned to the rows they are reading instead of being pushed down by every new trade.
 */
export function TradeTape() {
  const info = useSymbolInfo()
  const tradesTotal = useMarketStore((s) => s.tradesTotal)
  const scrollRef = useRef<HTMLDivElement>(null)
  const seenTotal = useRef(tradesTotal)
  const [unseen, setUnseen] = useState(0)
  const count = tradeTape.length

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => tradeTape.at(i)?.id ?? i,
  })

  useLayoutEffect(() => {
    const added = tradesTotal - seenTotal.current
    seenTotal.current = tradesTotal
    const el = scrollRef.current
    if (added < 0) setUnseen(0)
    if (added > 0 && el && el.scrollTop > 0) {
      el.scrollTop += added * ROW_HEIGHT
      setUnseen((u) => u + added)
    }
  }, [tradesTotal])

  const jumpToLatest = () => {
    scrollRef.current?.scrollTo({ top: 0 })
    setUnseen(0)
  }

  const qd = qtyDecimals(info.qtyDecimals)

  return (
    <section className="tape panel" aria-label="Trades">
      <div className="panel-head">
        <h2 className="panel-title">Trades</h2>
        <span className="panel-meta" data-testid="trade-count">
          {tradesTotal > count ? `Newest ${count.toLocaleString('en-US')} of ${tradesTotal.toLocaleString('en-US')}` : `${count.toLocaleString('en-US')} trades`}
        </span>
      </div>
      <div className="trade trade-head" aria-hidden>
        <span>Price</span>
        <span>Size</span>
        <span>Time</span>
      </div>
      <div
        ref={scrollRef}
        className="tape-scroll"
        data-testid="tape-scroll"
        onScroll={(e) => {
          if (e.currentTarget.scrollTop === 0 && unseen) setUnseen(0)
        }}
      >
        {count === 0 && <p className="note">Waiting for the first trade</p>}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const t = tradeTape.at(row.index)
            if (!t) return null
            return (
              <div
                key={row.key}
                className={`trade ${t.side}`}
                data-testid="trade-row"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <span className="trade-price">{formatFixed(t.price, info.priceDecimals)}</span>
                <span className="trade-qty">{formatFixed(t.qty, qd)}</span>
                <span className="trade-time">{formatTime(t.time)}</span>
              </div>
            )
          })}
        </div>
      </div>
      {unseen > 0 && (
        <button type="button" className="jump" onClick={jumpToLatest}>
          {unseen > 999 ? '999+' : unseen} new trades. Back to latest
        </button>
      )}
    </section>
  )
}
