// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { marketClient } from '../market/client'
import { useMarketStore } from '../market/store'
import { renderWithMarket } from '../test/dom'
import { MarketList } from './MarketList'

const fetchMock = vi.fn<typeof fetch>()
const row = (symbol: string, lastPrice: string, priceChangePercent: string) => ({
  symbol,
  lastPrice,
  priceChangePercent,
  quoteVolume: '1',
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('MarketList', () => {
  it('lists every pair with a price precision that suits it', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          row('BTCUSDT', '61240.99', '0.98'),
          row('BNBUSDT', '555.41', '0.33'),
          row('SOLUSDT', '72.15', '-2.87'),
          row('DOGEUSDT', '0.05556', '0.91'),
        ]),
      ),
    )
    renderWithMarket(<MarketList />)
    expect(screen.getByTestId('market-ETHUSDT')).toHaveTextContent('ETH…')

    const btc = await screen.findByText('61,240.99')
    expect(btc.closest('button')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('market-BNBUSDT')).toHaveTextContent('BNB555.41+0.33%')
    expect(screen.getByTestId('market-SOLUSDT')).toHaveTextContent('SOL72.150−2.87%')
    expect(screen.getByText('−2.87%')).toHaveClass('down')
    expect(screen.getByTestId('market-DOGEUSDT')).toHaveTextContent('DOGE0.05556+0.91%')
    expect(screen.getByTestId('market-ETHUSDT')).toHaveTextContent('ETH—')
    expect(screen.getAllByRole('button')).toHaveLength(12)
  })

  it('switches the market on click', async () => {
    fetchMock.mockResolvedValue(new Response('[]'))
    const select = vi.spyOn(marketClient, 'selectSymbol').mockImplementation((symbol) => {
      useMarketStore.setState({ symbol })
    })
    renderWithMarket(<MarketList />)
    await userEvent.click(screen.getByTestId('market-SOLUSDT'))
    expect(select).toHaveBeenCalledWith('SOLUSDT')
    expect(screen.getByTestId('market-SOLUSDT')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('market-BTCUSDT')).not.toHaveAttribute('aria-current')
  })

  it('says when prices are unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    renderWithMarket(<MarketList />)
    expect(await screen.findByText('Prices unavailable. Retrying every 10 seconds.')).toBeInTheDocument()
  })
})
