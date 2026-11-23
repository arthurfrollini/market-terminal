// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EMPTY_STATS, useMarketStore } from '../market/store'
import { liveBook, renderWithMarket } from '../test/dom'
import { FlowStrip } from './FlowStrip'

const value = (label: string) => screen.getByText(label).nextElementSibling
const meter = (label: string) => value(label)?.nextElementSibling as HTMLElement

describe('FlowStrip', () => {
  it('shows dashes and centred meters before any data', () => {
    renderWithMarket(<FlowStrip />)
    expect(screen.getByTestId('vwap')).toHaveTextContent('—')
    expect(value('Buy volume, last 60s')).toHaveTextContent('—')
    expect(value('Book imbalance, top 10')).toHaveTextContent('—')
    expect(meter('Buy volume, last 60s').style.getPropertyValue('--value')).toBe('0.5')
  })

  it('shows VWAP, buy share and imbalance once the book is live', () => {
    useMarketStore.setState({
      book: liveBook([[100, 1]], [[101, 1]]),
      stats: { ...EMPTY_STATS, vwap: 61_246.2, buyShare: 0.37, imbalance: -0.213 },
    })
    renderWithMarket(<FlowStrip />)
    expect(screen.getByTestId('vwap')).toHaveTextContent('61,246.20')
    expect(value('Buy volume, last 60s')).toHaveTextContent('37.0%')
    expect(value('Book imbalance, top 10')).toHaveTextContent('-21.3%')
    expect(meter('Buy volume, last 60s').style.getPropertyValue('--value')).toBe('0.37')
    expect(meter('Book imbalance, top 10').style.getPropertyValue('--value')).toBe('0.3935')
  })

  it('signs a positive imbalance', () => {
    useMarketStore.setState({ book: liveBook([[100, 1]], [[101, 1]]), stats: { ...EMPTY_STATS, imbalance: 0.05 } })
    renderWithMarket(<FlowStrip />)
    expect(value('Book imbalance, top 10')).toHaveTextContent('+5.0%')
  })
})
