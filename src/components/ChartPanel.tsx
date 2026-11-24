import type { KeyboardEvent } from 'react'
import { INTERVALS } from '../domain/candles'
import { marketClient } from '../market/client'
import { useMarketStore, type ChartView } from '../market/store'
import { CandleChart } from './CandleChart'
import { DepthChart } from './DepthChart'

const VIEWS: { view: ChartView; label: string }[] = [
  { view: 'price', label: 'Price' },
  { view: 'depth', label: 'Depth' },
]

/** Price candles or market depth in the same space. The hidden chart is unmounted, so it never paints. */
export function ChartPanel() {
  const view = useMarketStore((s) => s.chartView)
  const interval = useMarketStore((s) => s.interval)

  // Arrow keys move between tabs, as the ARIA tabs pattern expects.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const next = VIEWS[(VIEWS.findIndex((v) => v.view === view) + 1) % VIEWS.length].view
    marketClient.setChartView(next)
    e.currentTarget.querySelector<HTMLElement>(`#chart-tab-${next}`)?.focus()
  }

  return (
    <section className="chart panel" aria-label="Chart">
      <div className="panel-head">
        <div className="chart-tabs" role="tablist" aria-label="Chart type" onKeyDown={onKeyDown}>
          {VIEWS.map(({ view: v, label }) => (
            <button
              key={v}
              id={`chart-tab-${v}`}
              type="button"
              role="tab"
              className="chart-tab"
              aria-selected={view === v}
              aria-controls="chart-view"
              tabIndex={view === v ? 0 : -1}
              onClick={() => marketClient.setChartView(v)}
            >
              {label}
            </button>
          ))}
        </div>
        {view === 'price' ? (
          <div className="intervals" role="group" aria-label="Candle interval">
            {INTERVALS.map((i) => (
              <button
                key={i}
                type="button"
                className="toggle interval"
                aria-pressed={interval === i}
                onClick={() => marketClient.setInterval(i)}
              >
                {i}
              </button>
            ))}
          </div>
        ) : (
          <span className="panel-meta">Cumulative size within 0.5% of mid</span>
        )}
      </div>
      <div id="chart-view" className="chart-view" role="tabpanel" aria-labelledby={`chart-tab-${view}`}>
        {view === 'price' ? <CandleChart /> : <DepthChart />}
      </div>
    </section>
  )
}
