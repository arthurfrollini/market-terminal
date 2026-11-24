import { STRESS_RATES } from '../config'
import { marketClient } from '../market/client'
import { useMarketStore } from '../market/store'

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="metric">
      <span className="metric-value" data-testid={testId}>
        {value}
      </span>
      <span className="metric-label">{label}</span>
    </div>
  )
}

function PerfMetrics() {
  const fps = useMarketStore((s) => s.fps)
  const msgs = useMarketStore((s) => s.stats.msgsPerSec)
  const trades = useMarketStore((s) => s.stats.tradesPerSec)
  const load = useMarketStore((s) => s.stats.workerLoad)
  const thread = useMarketStore((s) => s.engineThread)
  const lag = useMarketStore((s) => s.eventLagMs)
  const resyncs = useMarketStore((s) => s.resyncs)
  return (
    <div className="metrics">
      <Metric label="fps" value={String(fps)} testId="fps" />
      <Metric label="messages/s" value={Math.round(msgs).toLocaleString('en-US')} testId="msgs-per-sec" />
      <Metric label="trades/s" value={Math.round(trades).toLocaleString('en-US')} />
      <Metric label={thread === 'main' ? 'engine busy, main thread' : 'worker busy'} value={`${(load * 100).toFixed(0)}%`} />
      <Metric label="event lag" value={lag !== null ? `${Math.max(0, Math.round(lag))} ms` : '—'} />
      <Metric label="book resyncs" value={String(resyncs)} testId="resyncs" />
    </div>
  )
}

function Controls() {
  const stress = useMarketStore((s) => s.stress)
  const rate = useMarketStore((s) => s.stressRate)
  const canDrop = useMarketStore((s) => !s.stress && s.conn.state === 'open')
  return (
    <div className="controls">
      <button
        type="button"
        className="toggle"
        aria-pressed={stress}
        data-testid="stress-toggle"
        onClick={() => marketClient.setStress(!stress)}
      >
        Stress test
      </button>
      <label>
        <span className="visually-hidden">Simulated messages per second</span>
        <select
          value={rate}
          disabled={!stress}
          onChange={(e) => marketClient.setStress(true, Number(e.target.value))}
        >
          {STRESS_RATES.map((r) => (
            <option key={r} value={r}>
              {r.toLocaleString('en-US')} msg/s
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => marketClient.dropConnection()} disabled={!canDrop} data-testid="drop">
        Drop connection
      </button>
    </div>
  )
}

export function StatusBar() {
  return (
    <footer className="statusbar">
      <PerfMetrics />
      <Controls />
    </footer>
  )
}
