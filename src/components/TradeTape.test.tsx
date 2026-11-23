// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tradeTape, useMarketStore } from '../market/store'
import type { Trade } from '../market/types'
import { renderWithMarket, trade } from '../test/dom'
import { TradeTape } from './TradeTape'

const VIEWPORT = 240 // 10 rows of 24px

function addTrades(from: number, to: number) {
  const trades: Trade[] = []
  for (let id = from; id <= to; id++) trades.push(trade(id, { side: id % 2 ? 'buy' : 'sell' }))
  act(() => {
    tradeTape.pushMany(trades)
    useMarketStore.setState((s) => ({ tradesTotal: s.tradesTotal + trades.length }))
  })
}

beforeEach(() => {
  // jsdom has no layout: give the scroll container a height so the virtualizer has rows to show.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'tape-scroll' ? VIEWPORT : 0
  })
})

describe('TradeTape', () => {
  it('waits for the first trade', () => {
    renderWithMarket(<TradeTape />)
    expect(screen.getByText('Waiting for the first trade')).toBeInTheDocument()
    expect(screen.getByTestId('trade-count')).toHaveTextContent('0 trades')
  })

  it('lists the newest trade first, coloured by side', () => {
    renderWithMarket(<TradeTape />)
    addTrades(1, 3)
    const rows = screen.getAllByTestId('trade-row')
    expect(rows.map((r) => r.className)).toEqual(['trade buy', 'trade sell', 'trade buy'])
    expect(Array.from(rows[0].children, (c) => c.textContent)).toEqual(['61,236.01', '0.00250', '09:41:00.003'])
    expect(screen.getByTestId('trade-count')).toHaveTextContent('3 trades')
  })

  it('keeps thousands of trades but renders only the visible rows plus overscan', () => {
    renderWithMarket(<TradeTape />)
    addTrades(1, 5_000)
    expect(screen.getByTestId('trade-count')).toHaveTextContent('5,000 trades')
    expect(screen.getAllByTestId('trade-row').length).toBe(VIEWPORT / 24 + 12)
  })

  it('says how many it keeps once the tape is full', () => {
    renderWithMarket(<TradeTape />)
    addTrades(1, 12_000)
    expect(screen.getByTestId('trade-count')).toHaveTextContent('Newest 10,000 of 12,000')
  })

  it('holds the reader in place when new trades arrive and offers a way back', async () => {
    renderWithMarket(<TradeTape />)
    addTrades(1, 100)
    const scroll = screen.getByTestId('tape-scroll')
    scroll.scrollTop = 480
    fireEvent.scroll(scroll)

    addTrades(101, 105)
    expect(scroll.scrollTop).toBe(480 + 5 * 24)
    const jump = screen.getByRole('button', { name: '5 new trades. Back to latest' })

    scroll.scrollTo = vi.fn((opts) => {
      scroll.scrollTop = (opts as ScrollToOptions).top ?? 0
    })
    await userEvent.click(jump)
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 0 })
    expect(screen.queryByRole('button', { name: /new trades/ })).not.toBeInTheDocument()
  })

  it('caps the counter at 999+ and clears it when the reader scrolls back up', () => {
    renderWithMarket(<TradeTape />)
    addTrades(1, 10)
    const scroll = screen.getByTestId('tape-scroll')
    scroll.scrollTop = 24
    addTrades(11, 1_100)
    expect(screen.getByRole('button', { name: '999+ new trades. Back to latest' })).toBeInTheDocument()

    scroll.scrollTop = 0
    fireEvent.scroll(scroll)
    expect(screen.queryByRole('button', { name: /new trades/ })).not.toBeInTheDocument()
  })

  it('does not move the view while the reader is at the top', () => {
    renderWithMarket(<TradeTape />)
    addTrades(1, 10)
    addTrades(11, 20)
    expect(screen.getByTestId('tape-scroll').scrollTop).toBe(0)
    expect(screen.queryByRole('button', { name: /new trades/ })).not.toBeInTheDocument()
  })

  it('clears the counter when the tape resets for a new symbol', () => {
    renderWithMarket(<TradeTape />)
    addTrades(1, 10)
    screen.getByTestId('tape-scroll').scrollTop = 24
    addTrades(11, 12)
    expect(screen.getByRole('button', { name: /new trades/ })).toBeInTheDocument()

    act(() => {
      tradeTape.clear()
      useMarketStore.setState({ tradesTotal: 0 })
    })
    expect(screen.queryByRole('button', { name: /new trades/ })).not.toBeInTheDocument()
  })
})
