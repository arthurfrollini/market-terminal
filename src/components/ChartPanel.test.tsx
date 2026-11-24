// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { marketClient } from '../market/client'
import { useMarketStore } from '../market/store'
import { fakeCanvasContext, renderWithMarket } from '../test/dom'
import { ChartPanel } from './ChartPanel'

function setup() {
  fakeCanvasContext()
  renderWithMarket(<ChartPanel />)
  return userEvent.setup()
}

describe('ChartPanel', () => {
  it('opens on the price chart', () => {
    setup()
    expect(screen.getByRole('tab', { name: 'Price' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('candle-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('depth-canvas')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1m' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches to depth, unmounting the candles and hiding the intervals', async () => {
    const user = setup()
    await user.click(screen.getByRole('tab', { name: 'Depth' }))
    expect(screen.getByRole('tab', { name: 'Depth' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('depth-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('candle-canvas')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '1m' })).not.toBeInTheDocument()
    expect(screen.getByText('Cumulative size within 0.5% of mid')).toBeInTheDocument()
  })

  it('changes the interval through the market client', async () => {
    const setInterval = vi.spyOn(marketClient, 'setInterval')
    const user = setup()
    await user.click(screen.getByRole('button', { name: '5m' }))
    expect(setInterval).toHaveBeenCalledWith('5m')
    expect(useMarketStore.getState().interval).toBe('5m')
    expect(screen.getByRole('button', { name: '5m' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1m' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('moves between tabs with the arrow keys', async () => {
    const user = setup()
    await user.click(screen.getByRole('tab', { name: 'Price' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Depth' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Depth' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Price' })).toHaveFocus()
  })
})
