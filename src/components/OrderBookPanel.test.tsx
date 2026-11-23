// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { marketClient } from '../market/client'
import { useMarketStore } from '../market/store'
import { liveBook, renderWithMarket } from '../test/dom'
import { OrderBookPanel } from './OrderBookPanel'

const cells = (row: HTMLElement) => Array.from(row.children, (c) => c.textContent)

describe('OrderBookPanel', () => {
  it('says it is syncing until the book is live', () => {
    renderWithMarket(<OrderBookPanel />)
    expect(screen.getByText('Syncing order book')).toBeInTheDocument()
    expect(screen.getByTestId('order-book')).toHaveAttribute('data-status', 'idle')

    act(() => useMarketStore.setState({ book: liveBook([[100, 1]], [[101, 1]], { status: 'buffering' }) }))
    expect(screen.getByText('Syncing order book')).toBeInTheDocument()
    expect(screen.getByTestId('order-book')).toHaveAttribute('data-status', 'buffering')
  })

  it('shows asks above the spread, best ask nearest to it, and bids below', () => {
    useMarketStore.setState({
      book: liveBook(
        [[61_236, 0.5], [61_235.5, 1.25]],
        [[61_236.01, 0.2], [61_237, 2]],
      ),
    })
    renderWithMarket(<OrderBookPanel />)

    const asks = screen.getAllByTestId('ask-row')
    expect(asks.map(cells)).toEqual([
      ['61,237.00', '2.00000', '2.20000'],
      ['61,236.01', '0.20000', '0.20000'],
    ])
    expect(screen.getAllByTestId('bid-row').map(cells)).toEqual([
      ['61,236.00', '0.50000', '0.50000'],
      ['61,235.50', '1.25000', '1.75000'],
    ])
    const spread = screen.getByTestId('spread')
    expect(within(spread).getByText('61,236.005')).toBeInTheDocument()
    expect(within(spread).getByText('Spread 0.01 (<0.01 bps)')).toBeInTheDocument()
  })

  it('sizes depth bars against the deeper side', () => {
    useMarketStore.setState({ book: liveBook([[100, 1], [99, 1]], [[101, 4]]) })
    renderWithMarket(<OrderBookPanel />)
    expect(screen.getAllByTestId('bid-row').map((r) => r.style.getPropertyValue('--fill'))).toEqual(['25.0%', '50.0%'])
    expect(screen.getByTestId('ask-row').style.getPropertyValue('--fill')).toBe('100.0%')
  })

  it('shows at most 14 levels per side', () => {
    const side = (start: number, dir: number) => Array.from({ length: 20 }, (_, i): [number, number] => [start + dir * i, 1])
    useMarketStore.setState({ book: liveBook(side(100, -1), side(101, 1)) })
    renderWithMarket(<OrderBookPanel />)
    expect(screen.getAllByTestId('bid-row')).toHaveLength(14)
    expect(screen.getAllByTestId('ask-row')).toHaveLength(14)
  })

  it('offers groupings from the tick size and sends the chosen one to the worker', async () => {
    const setGrouping = vi.spyOn(marketClient, 'setGrouping').mockImplementation((step) => {
      useMarketStore.setState({ grouping: step })
    })
    useMarketStore.setState({ book: liveBook([[61_236, 1]], [[61_237, 1]]) })
    renderWithMarket(<OrderBookPanel />)

    const select = screen.getByTestId('grouping')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['0.01', '0.1', '1', '10', '100'])
    expect(select).toHaveValue('0.01')

    await userEvent.selectOptions(select, '10')
    expect(setGrouping).toHaveBeenCalledWith(10)
    expect(cells(screen.getByTestId('bid-row'))[0]).toBe('61,236')
  })

  it('labels the size column with the base asset', () => {
    renderWithMarket(<OrderBookPanel />)
    expect(screen.getByText('Size (BTC)')).toBeInTheDocument()
  })
})
