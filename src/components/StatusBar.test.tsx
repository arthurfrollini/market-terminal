// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { marketClient } from '../market/client'
import { EMPTY_STATS, useMarketStore } from '../market/store'
import { renderWithMarket } from '../test/dom'
import { StatusBar } from './StatusBar'

const metric = (label: string) => screen.getByText(label).previousElementSibling?.textContent

describe('StatusBar', () => {
  it('shows the live performance numbers', () => {
    useMarketStore.setState({
      fps: 74,
      stats: { ...EMPTY_STATS, msgsPerSec: 19_876.4, tradesPerSec: 3.6, workerLoad: 0.113 },
      eventLagMs: 12.4,
      resyncs: 2,
    })
    renderWithMarket(<StatusBar />)
    expect(metric('fps')).toBe('74')
    expect(metric('messages/s')).toBe('19,876')
    expect(metric('trades/s')).toBe('4')
    expect(metric('worker busy')).toBe('11%')
    expect(metric('event lag')).toBe('12 ms')
    expect(metric('book resyncs')).toBe('2')
  })

  it('shows a dash before the first event and never a negative lag', () => {
    renderWithMarket(<StatusBar />)
    expect(metric('event lag')).toBe('—')
    act(() => useMarketStore.setState({ eventLagMs: -30 }))
    expect(metric('event lag')).toBe('0 ms')
  })

  it('toggles stress mode and only lets the rate change while it is on', async () => {
    const setStress = vi.spyOn(marketClient, 'setStress').mockImplementation((enabled, rate) => {
      useMarketStore.setState({ stress: enabled, ...(rate ? { stressRate: rate } : {}) })
    })
    renderWithMarket(<StatusBar />)
    const toggle = screen.getByTestId('stress-toggle')
    const rate = screen.getByRole('combobox', { name: 'Simulated messages per second' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(rate).toBeDisabled()

    await userEvent.click(toggle)
    expect(setStress).toHaveBeenLastCalledWith(true)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(rate).toBeEnabled()

    await userEvent.selectOptions(rate, '20000')
    expect(setStress).toHaveBeenLastCalledWith(true, 20_000)
    expect(rate).toHaveValue('20000')
  })

  it('only allows dropping a live Binance connection', async () => {
    const drop = vi.spyOn(marketClient, 'dropConnection').mockImplementation(() => {})
    renderWithMarket(<StatusBar />)
    const button = screen.getByTestId('drop')
    expect(button).toBeDisabled()

    act(() => useMarketStore.setState((s) => ({ conn: { ...s.conn, state: 'open' } })))
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(drop).toHaveBeenCalledOnce()

    act(() => useMarketStore.setState({ stress: true }))
    expect(button).toBeDisabled()
  })
})
