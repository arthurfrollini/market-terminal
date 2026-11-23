// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMarketStore } from '../market/store'
import type { ConnStatus, Ticker } from '../market/types'
import { renderWithMarket } from '../test/dom'
import { TopBar } from './TopBar'

const ticker: Ticker = {
  symbol: 'BTCUSDT',
  last: 61_236.01,
  open: 60_650,
  high: 61_959.93,
  low: 60_386,
  baseVolume: 15_820,
  quoteVolume: 968_790_000,
  changePct: 0.96,
}

describe('TopBar', () => {
  it('shows the raw symbol and dashes until details and prices arrive', () => {
    renderWithMarket(<TopBar />, { info: null })
    expect(screen.getByTestId('symbol')).toHaveTextContent('BTCUSDT')
    expect(screen.getByTestId('last-price')).toHaveTextContent('—')
    expect(screen.getAllByText('—')).toHaveLength(4)
  })

  it('shows the pair, last price, change and 24h stats', () => {
    useMarketStore.setState({ ticker })
    renderWithMarket(<TopBar />)
    expect(screen.getByTestId('symbol')).toHaveTextContent('BTC/USDT')
    expect(screen.getByTestId('last-price')).toHaveTextContent('61,236.01')
    expect(screen.getByText('+0.96%').parentElement).toHaveClass('last up')
    expect(screen.getByText('24h high').nextElementSibling).toHaveTextContent('61,959.93')
    expect(screen.getByText('24h low').nextElementSibling).toHaveTextContent('60,386.00')
    expect(screen.getByText('24h volume').nextElementSibling).toHaveTextContent('968.79M USDT')
  })

  it('marks a falling price', () => {
    useMarketStore.setState({ ticker: { ...ticker, changePct: -1.5 } })
    renderWithMarket(<TopBar />)
    expect(screen.getByText('−1.50%').parentElement).toHaveClass('last down')
  })

  it.each<[Partial<ConnStatus>, string]>([
    [{ state: 'idle' }, 'Waiting'],
    [{ state: 'connecting' }, 'Connecting'],
    [{ state: 'open' }, 'Live'],
    [{ state: 'reconnecting', attempt: 2, retryInMs: 1_500 }, 'Reconnecting in 1.5s (attempt 2)'],
    [{ state: 'reconnecting', attempt: 3, retryInMs: null }, 'Reconnecting (attempt 3)'],
    [{ state: 'closed' }, 'Disconnected'],
    [{ state: 'open', source: 'synthetic' }, 'Simulated feed'],
  ])('labels the connection %o as "%s"', (conn, label) => {
    useMarketStore.setState((s) => ({ conn: { ...s.conn, ...conn } }))
    renderWithMarket(<TopBar />)
    expect(screen.getByRole('status')).toHaveTextContent(label)
  })
})
