import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

type Level = [string, string]

export interface Snapshot {
  lastUpdateId: number
  bids: Level[]
  asks: Level[]
}

interface Client {
  socket: WebSocket
  streams: string[]
}

export const DEFAULT_SNAPSHOT: Snapshot = {
  lastUpdateId: 100,
  bids: [['100.00', '1.00000'], ['99.90', '2.00000']],
  asks: [['100.10', '1.50000'], ['100.20', '3.00000']],
}

const INTERVAL_MS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 }

/** 60 flat candles ending at the current one, in the REST row format. */
function defaultKlines(interval: string) {
  const ms = INTERVAL_MS[interval] ?? 60_000
  const now = Math.floor(Date.now() / ms) * ms
  return Array.from({ length: 60 }, (_, i) => {
    const t = now - (59 - i) * ms
    return [t, '100.00', '100.20', '99.90', '100.10', '12.00000', t + ms - 1, '1200.0', 10, '6.0', '600.0', '0']
  })
}

/**
 * A scriptable stand-in for Binance: REST (exchangeInfo, 24h tickers, depth, klines) and the
 * combined WebSocket stream, with SUBSCRIBE and UNSUBSCRIBE, on one port. Tests push exact
 * messages and can kill connections at will.
 */
export class MockBinance {
  private readonly server = createServer((req, res) => this.handleHttp(req, res))
  private readonly wss = new WebSocketServer({ server: this.server, path: '/stream' })
  private readonly clients: Client[] = []
  private readonly snapshots = new Map<string, Snapshot>()
  private readonly snapshotHits = new Map<string, number>()
  private readonly klineHits = new Map<string, number>()
  private connectionCount = 0

  constructor() {
    this.wss.on('connection', (socket, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const client = { socket, streams: (url.searchParams.get('streams') ?? '').split('/') }
      this.clients.push(client)
      this.connectionCount++
      socket.on('close', () => this.clients.splice(this.clients.indexOf(client), 1))
      socket.on('message', (raw) => {
        const { method, params, id } = JSON.parse(String(raw)) as { method: string; params: string[]; id: number }
        if (method === 'SUBSCRIBE') client.streams.push(...params.filter((p) => !client.streams.includes(p)))
        if (method === 'UNSUBSCRIBE') client.streams = client.streams.filter((p) => !params.includes(p))
        socket.send(JSON.stringify({ result: null, id }))
      })
    })
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.socket.terminate()
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  get httpUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  get wsUrl(): string {
    return this.httpUrl.replace('http', 'ws')
  }

  appUrl(extra = ''): string {
    return `/?ws=${encodeURIComponent(this.wsUrl)}&rest=${encodeURIComponent(this.httpUrl)}${extra}`
  }

  setSnapshot(symbol: string, snapshot: Snapshot): void {
    this.snapshots.set(symbol, snapshot)
  }

  snapshotRequests(symbol: string): number {
    return this.snapshotHits.get(symbol) ?? 0
  }

  klineRequests(symbol: string, interval: string): number {
    return this.klineHits.get(`${symbol}:${interval}`) ?? 0
  }

  get totalConnections(): number {
    return this.connectionCount
  }

  openStreams(): string[][] {
    return this.clients.map((c) => c.streams)
  }

  /** Sends `data` on a stream (e.g. `btcusdt@trade`) to every client subscribed to it. */
  send(stream: string, data: object): void {
    const text = JSON.stringify({ stream, data })
    for (const c of this.clients) if (c.streams.includes(stream)) c.socket.send(text)
  }

  /** Cuts every connection without a close handshake, like a network drop. */
  dropAll(): void {
    for (const c of [...this.clients]) c.socket.terminate()
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      res.end(JSON.stringify(body))
    }
    switch (url.pathname) {
      case '/api/v3/exchangeInfo': {
        const symbol = url.searchParams.get('symbol') ?? 'BTCUSDT'
        return json({
          symbols: [
            {
              symbol,
              baseAsset: symbol.replace(/USDT$/, ''),
              quoteAsset: 'USDT',
              filters: [
                { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
                { filterType: 'LOT_SIZE', stepSize: '0.00001000' },
              ],
            },
          ],
        })
      }
      case '/api/v3/ticker/24hr': {
        const symbols = JSON.parse(url.searchParams.get('symbols') ?? '[]') as string[]
        return json(
          symbols.map((symbol) => ({ symbol, lastPrice: '100.00', priceChangePercent: '1.5', quoteVolume: '1000000' })),
        )
      }
      case '/api/v3/depth': {
        const symbol = url.searchParams.get('symbol') ?? ''
        this.snapshotHits.set(symbol, this.snapshotRequests(symbol) + 1)
        return json(this.snapshots.get(symbol) ?? DEFAULT_SNAPSHOT)
      }
      case '/api/v3/klines': {
        const key = `${url.searchParams.get('symbol')}:${url.searchParams.get('interval')}`
        this.klineHits.set(key, (this.klineHits.get(key) ?? 0) + 1)
        return json(defaultKlines(url.searchParams.get('interval') ?? '1m'))
      }
      default:
        res.writeHead(404, { 'access-control-allow-origin': '*' })
        res.end()
    }
  }
}

export const depthUpdate = (symbol: string, U: number, u: number, b: Level[] = [], a: Level[] = []) => ({
  e: 'depthUpdate',
  E: Date.now(),
  s: symbol,
  U,
  u,
  b,
  a,
})

export const tradeEvent = (symbol: string, id: number, price: string, qty: string, buyerIsMaker = false) => ({
  e: 'trade',
  E: Date.now(),
  s: symbol,
  t: id,
  p: price,
  q: qty,
  T: Date.now(),
  m: buyerIsMaker,
})

export interface KlineFields {
  t: number
  o: string
  h: string
  l: string
  c: string
  v: string
}

export const klineEvent = (symbol: string, interval: string, k: KlineFields) => ({
  e: 'kline',
  E: Date.now(),
  s: symbol,
  k: { ...k, T: k.t + (INTERVAL_MS[interval] ?? 60_000) - 1, s: symbol, i: interval, x: false },
})
