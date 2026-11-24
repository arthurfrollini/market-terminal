import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError, depthSnapshotQuery, klinesQuery, retryable, symbolInfoQuery, tickers24hQuery } from './binance'

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('retryable', () => {
  it('does not retry client errors, which will not fix themselves', () => {
    expect(retryable(0, new HttpError(400, 'bad symbol'))).toBe(false)
    expect(retryable(0, new HttpError(404, 'not found'))).toBe(false)
  })

  it('retries rate limits, server errors and network failures up to 3 times', () => {
    for (const error of [new HttpError(429, 'slow down'), new HttpError(503, 'down'), new TypeError('network')]) {
      expect(retryable(0, error)).toBe(true)
      expect(retryable(2, error)).toBe(true)
      expect(retryable(3, error)).toBe(false)
    }
  })
})

describe('symbolInfoQuery', () => {
  it('reads tick and step sizes from the exchange filters', async () => {
    fetchMock.mockResolvedValue(
      json({
        symbols: [
          {
            symbol: 'BTCUSDT',
            baseAsset: 'BTC',
            quoteAsset: 'USDT',
            filters: [
              { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
              { filterType: 'LOT_SIZE', stepSize: '0.00001000' },
            ],
          },
        ],
      }),
    )
    const info = await client().fetchQuery(symbolInfoQuery('BTCUSDT'))
    expect(fetchMock.mock.calls[0][0]).toBe('https://data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT')
    expect(info).toEqual({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      tickSize: 0.01,
      stepSize: 0.00001,
      priceDecimals: 2,
      qtyDecimals: 5,
    })
  })

  it('falls back to common sizes when a filter is missing', async () => {
    fetchMock.mockResolvedValue(json({ symbols: [{ symbol: 'XUSDT', baseAsset: 'X', quoteAsset: 'USDT', filters: [] }] }))
    const info = await client().fetchQuery(symbolInfoQuery('XUSDT'))
    expect(info).toMatchObject({ tickSize: 0.01, stepSize: 0.00001, priceDecimals: 2, qtyDecimals: 5 })
  })

  it('fails with the HTTP status when Binance rejects the request', async () => {
    fetchMock.mockResolvedValue(json({ code: -1121, msg: 'Invalid symbol.' }, 400))
    const error = await client().fetchQuery(symbolInfoQuery('NOPE')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 400, message: 'GET /api/v3/exchangeInfo?symbol=NOPE failed with 400' })
  })
})

describe('tickers24hQuery', () => {
  it('asks for all symbols in one request and parses the numbers', async () => {
    fetchMock.mockResolvedValue(
      json([{ symbol: 'BTCUSDT', lastPrice: '61236.01', priceChangePercent: '-0.96', quoteVolume: '968790000.5' }]),
    )
    const qc = client()
    const options = tickers24hQuery(['BTCUSDT', 'ETHUSDT'])
    const rows = options.select!(await qc.fetchQuery(options))
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22%2C%22ETHUSDT%22%5D',
    )
    expect(rows).toEqual([{ symbol: 'BTCUSDT', last: 61236.01, changePct: -0.96, quoteVolume: 968790000.5 }])
  })
})

describe('depthSnapshotQuery', () => {
  it('requests the deepest snapshot and never caches it', async () => {
    const snapshot = { lastUpdateId: 7, bids: [], asks: [] }
    fetchMock.mockResolvedValue(json(snapshot))
    expect(await client().fetchQuery(depthSnapshotQuery('ETHUSDT'))).toEqual(snapshot)
    expect(fetchMock.mock.calls[0][0]).toBe('https://data-api.binance.vision/api/v3/depth?symbol=ETHUSDT&limit=5000')
    expect(depthSnapshotQuery('ETHUSDT')).toMatchObject({ staleTime: 0, gcTime: 0 })
  })
})

describe('klinesQuery', () => {
  it('requests 500 candles for the interval, parses them and never caches them', async () => {
    fetchMock.mockResolvedValue(
      json([[1795528800000, '60014.59', '60078.84', '59984.26', '60067.66', '9.57028', 1795528859999, '574580.6', 2311, '7.4', '447100.2', '0']]),
    )
    const candles = await client().fetchQuery(klinesQuery('BTCUSDT', '5m'))
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=500',
    )
    expect(candles).toEqual([
      { openTime: 1795528800000, open: 60014.59, high: 60078.84, low: 59984.26, close: 60067.66, volume: 9.57028 },
    ])
    expect(klinesQuery('BTCUSDT', '5m')).toMatchObject({ queryKey: ['klines', 'BTCUSDT', '5m'], staleTime: 0, gcTime: 0 })
  })
})
