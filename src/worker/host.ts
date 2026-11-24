import { klineStream, streamUrl } from '../domain/binance'
import { SyntheticFeed } from '../feed/synthetic'
import type { ConnStatus, FeedSource, FromWorker, ToWorker } from '../market/types'
import { ReconnectingSocket } from '../net/ReconnectingSocket'
import { MarketEngine, frameTransferables } from './engine'

export type Post = (msg: FromWorker, transfer: Transferable[]) => void

export interface MarketHost {
  handle(msg: ToWorker): void
  /** Closes the socket or the simulated feed. */
  stop(): void
}

/**
 * Everything the worker runs: the feed (socket or simulated), the engine and the replies to the UI.
 * It normally runs in the Web Worker; `?engine=main` runs it on the main thread for comparison.
 */
export function createMarketHost(postMessage: Post): MarketHost {
  function post(msg: FromWorker, transfer: Transferable[] = []): void {
    postMessage(msg, transfer)
  }

  const engine = new MarketEngine({
    onNeedSnapshot: (reason) => post({ type: 'need-snapshot', symbol: engine.symbol, reason }),
    onNeedHistory: () => post({ type: 'need-history', symbol: engine.symbol, interval: engine.interval }),
  })

  let socket: ReconnectingSocket | null = null
  let synthetic: SyntheticFeed | null = null
  let wsBase = ''
  let tickSize = 0.01
  let stress = { enabled: false, messagesPerSecond: 5000 }
  let requestId = 0

  function status(source: FeedSource, s: Omit<ConnStatus, 'source'>): void {
    post({ type: 'status', status: { ...s, source } })
  }

  function stopFeeds(): void {
    socket?.close()
    socket = null
    synthetic?.stop()
    synthetic = null
  }

  function startFeed(): void {
    stopFeeds()
    if (stress.enabled) {
      const feed = new SyntheticFeed({
        symbol: engine.symbol,
        midPrice: engine.referencePrice ?? 100,
        tickSize,
        messagesPerSecond: stress.messagesPerSecond,
        interval: engine.interval,
        onMessage: (text) => engine.handleMessage(text),
      })
      synthetic = feed
      engine.start(engine.symbol, engine.grouping)
      engine.resync('initial', false)
      engine.applySnapshot(engine.symbol, feed.snapshot())
      engine.requestHistory()
      feed.start()
      status('synthetic', { state: 'open', attempt: 0, retryInMs: null })
      return
    }
    engine.start(engine.symbol, engine.grouping)
    socket = new ReconnectingSocket({
      url: streamUrl(wsBase, engine.symbol, engine.interval),
      onMessage: (text) => engine.handleMessage(text),
      // Diffs may have been missed while disconnected, so every open starts a fresh sync.
      onOpen: () => {
        engine.resync('initial')
        engine.requestHistory()
      },
      onStatus: (s) => status('binance', s),
    })
    socket.connect()
  }

    function handle(msg: ToWorker): void {
    switch (msg.type) {
      case 'start':
        wsBase = msg.wsBase
        tickSize = msg.tickSize
        engine.symbol = msg.symbol
        engine.grouping = msg.grouping
        engine.interval = msg.interval
        startFeed()
        break
      case 'snapshot':
        engine.applySnapshot(msg.symbol, msg.snapshot)
        break
      case 'interval': {
        const previous = engine.interval
        if (msg.interval === previous) break
        engine.setInterval(msg.interval)
        synthetic?.setInterval(msg.interval)
        if (socket) {
          // Same socket, so the book keeps its sync. If it's down, the reconnect uses the new URL.
          socket.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [klineStream(engine.symbol, previous)], id: ++requestId }))
          socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: [klineStream(engine.symbol, msg.interval)], id: ++requestId }))
          socket.setUrl(streamUrl(wsBase, engine.symbol, msg.interval))
        }
        break
      }
      case 'history':
        engine.applyHistory(msg.symbol, msg.interval, msg.candles)
        break
      case 'grouping':
        engine.setGrouping(msg.step)
        break
      case 'stress':
        stress = { enabled: msg.enabled, messagesPerSecond: msg.messagesPerSecond }
        if (engine.symbol) startFeed()
        break
      case 'pull': {
        // Always answer: the UI sends the next pull only after this reply.
        try {
          const frame = engine.buildFrame()
          post({ type: 'frame', frame }, frame ? frameTransferables(frame) : [])
        } catch (err) {
          post({ type: 'frame', frame: null })
          throw err
        }
        break
      }
      case 'drop':
        socket?.drop()
        break
    }
  }

  return { handle, stop: stopFeeds }
}
