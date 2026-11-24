// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { marketClient } from './market/client'
import { BTC, renderWithMarket } from './test/dom'

const fetchMock = vi.fn<typeof fetch>()
const exchangeInfo = {
  symbols: [
    {
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.01' },
        { filterType: 'LOT_SIZE', stepSize: '0.00001' },
      ],
    },
  ],
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url) =>
    String(url).includes('exchangeInfo') ? new Response(JSON.stringify(exchangeInfo)) : new Response('[]'),
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

describe('App', () => {
  it('starts the feed once the tick size is known and stops it on unmount', async () => {
    const start = vi.spyOn(marketClient, 'start').mockImplementation(() => {})
    const stop = vi.spyOn(marketClient, 'stop').mockImplementation(() => {})
    const { unmount } = renderWithMarket(<App />, { info: null })
    expect(start).not.toHaveBeenCalled()

    await waitFor(() => expect(start).toHaveBeenCalledWith('BTCUSDT', 0.01))
    for (const name of ['Markets', 'Chart', 'Order flow', 'Trades', 'Order book']) {
      expect(screen.getByRole(name === 'Markets' ? 'navigation' : 'region', { name })).toBeInTheDocument()
    }
    unmount()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('explains a failed details request and retries on demand', async () => {
    const start = vi.spyOn(marketClient, 'start').mockImplementation(() => {})
    vi.spyOn(marketClient, 'stop').mockImplementation(() => {})
    fetchMock.mockImplementation(async () => new Response('', { status: 503 }))
    renderWithMarket(<App />, { info: null })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load BTCUSDT market details, so the live feed hasn't started.")
    expect(screen.queryByTestId('candle-canvas')).not.toBeInTheDocument()

    fetchMock.mockImplementation(async (url) =>
      String(url).includes('exchangeInfo') ? new Response(JSON.stringify(exchangeInfo)) : new Response('[]'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('BTCUSDT', BTC.tickSize))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
