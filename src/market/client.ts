import { depthSnapshotQuery, queryClient } from '../api/binance'
import { WS_BASE } from '../config'
import { initialMarketState, tradeTape, useMarketStore } from './store'
import type { FromWorker, ToWorker, WorkerFrame } from './types'

const SNAPSHOT_RETRY_MS = 2_000
const FPS_SAMPLE_MS = 500

/**
 * Main-thread side of the worker. Pull model: one `pull` per animation frame, never more than
 * one in flight, so a slow UI makes the worker coalesce harder instead of queueing frames.
 */
class MarketClient {
  private worker: Worker | null = null
  private raf = 0
  private awaitingFrame = false
  private frames = 0
  private fpsSince = 0

  start(symbol: string, tickSize: number): void {
    const worker = this.ensureWorker()
    const { stress, stressRate, grouping } = useMarketStore.getState()
    worker.postMessage({ type: 'stress', enabled: stress, messagesPerSecond: stressRate } satisfies ToWorker)
    this.send({ type: 'start', symbol, wsBase: WS_BASE, grouping: grouping ?? tickSize, tickSize })
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.worker?.terminate()
    this.worker = null
    this.awaitingFrame = false
  }

  selectSymbol(symbol: string): void {
    const { symbol: current, stress, stressRate } = useMarketStore.getState()
    if (symbol === current) return
    tradeTape.clear()
    // Keep user preferences, drop everything tied to the old symbol.
    useMarketStore.setState({ ...initialMarketState(symbol), stress, stressRate })
  }

  setGrouping(step: number): void {
    useMarketStore.setState({ grouping: step })
    this.send({ type: 'grouping', step })
  }

  setStress(enabled: boolean, messagesPerSecond = useMarketStore.getState().stressRate): void {
    tradeTape.clear()
    useMarketStore.setState({
      stress: enabled,
      stressRate: messagesPerSecond,
      book: null,
      ticker: null,
      tradesTotal: 0,
      eventLagMs: null,
    })
    this.send({ type: 'stress', enabled, messagesPerSecond })
  }

  /** Kills the live socket so the reconnect path can be watched (or tested) on demand. */
  dropConnection(): void {
    this.send({ type: 'drop' })
  }

  private send(msg: ToWorker): void {
    this.worker?.postMessage(msg)
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('../worker/market.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data)
    this.worker = worker
    this.fpsSince = performance.now()
    this.raf = requestAnimationFrame(this.loop)
    return worker
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop)
    this.frames++
    if (now - this.fpsSince >= FPS_SAMPLE_MS) {
      useMarketStore.setState({ fps: Math.round((this.frames * 1000) / (now - this.fpsSince)) })
      this.frames = 0
      this.fpsSince = now
    }
    if (!this.awaitingFrame) {
      this.awaitingFrame = true
      this.send({ type: 'pull' })
    }
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'frame':
        this.awaitingFrame = false
        if (msg.frame) this.applyFrame(msg.frame)
        break
      case 'status':
        useMarketStore.setState({ conn: msg.status })
        break
      case 'need-snapshot':
        useMarketStore.setState((s) => ({
          resyncs: msg.reason === 'initial' ? s.resyncs : s.resyncs + 1,
          lastResync: msg.reason,
        }))
        void this.loadSnapshot(msg.symbol)
        break
    }
  }

  private applyFrame(frame: WorkerFrame): void {
    if (frame.symbol !== useMarketStore.getState().symbol) return
    const fresh = frame.trades.length > 0 || frame.book !== null
    if (frame.trades.length > 0) tradeTape.pushMany(frame.trades)
    useMarketStore.setState((s) => ({
      book: frame.book ?? s.book,
      ticker: frame.ticker ?? s.ticker,
      stats: frame.stats,
      tradesTotal: s.tradesTotal + frame.trades.length,
      eventLagMs: fresh && frame.stats.lastEventTime > 0 ? Date.now() - frame.stats.lastEventTime : s.eventLagMs,
    }))
  }

  /** TanStack Query dedupes concurrent requests for the same symbol and retries transient errors. */
  private async loadSnapshot(symbol: string): Promise<void> {
    try {
      const snapshot = await queryClient.fetchQuery(depthSnapshotQuery(symbol))
      if (symbol === useMarketStore.getState().symbol) this.send({ type: 'snapshot', symbol, snapshot })
    } catch {
      setTimeout(() => {
        const { symbol: current, book, stress } = useMarketStore.getState()
        if (symbol === current && !stress && book?.status !== 'live') void this.loadSnapshot(symbol)
      }, SNAPSHOT_RETRY_MS)
    }
  }
}

export const marketClient = new MarketClient()
