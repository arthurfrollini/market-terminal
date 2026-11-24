// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CandleSeries } from '../domain/candles'
import { useMarketStore } from '../market/store'
import type { CandleFrame } from '../market/types'
import { FakeResizeObserver, animationFrame, fakeCanvasContext, pendingFrames, renderWithMarket } from '../test/dom'
import { CandleChart } from './CandleChart'

/** Candles a minute apart; each opens 1 below its close, with a 2 up / 3 down range. */
function candles(closes: number[]): CandleFrame {
  const s = new CandleSeries()
  closes.forEach((close, i) =>
    s.upsert({ openTime: i * 60_000, open: close - 1, high: close + 2, low: close - 3, close, volume: 10 + i }),
  )
  return { symbol: 'BTCUSDT', interval: '1m', ...s.toArrays() }
}

const thirty = Array.from({ length: 30 }, (_, i) => 100 + i)

function setup() {
  const { texts, placed } = fakeCanvasContext()
  renderWithMarket(<CandleChart />)
  const canvas = screen.getByTestId('candle-canvas') as HTMLCanvasElement
  act(() => FakeResizeObserver.all[0].resize(600, 300))
  const paint = () => {
    texts.length = 0
    placed.length = 0
    act(() => animationFrame())
  }
  return { canvas, texts, placed, paint }
}

function hover(canvas: HTMLCanvasElement, offsetX: number) {
  const event = new MouseEvent('pointermove')
  Object.defineProperty(event, 'offsetX', { value: offsetX })
  Object.defineProperty(event, 'offsetY', { value: 50 })
  fireEvent(canvas, event)
}

describe('CandleChart', () => {
  it('waits for candles', () => {
    const { paint, texts } = setup()
    paint()
    expect(texts).toEqual(['Waiting for candles'])
  })

  it('draws the price axis, the RSI levels and a legend for the latest candle', () => {
    const { paint, texts } = setup()
    useMarketStore.setState({ candles: candles(thirty) })
    paint()
    expect(texts).toContain('129.00') // last close on the price axis
    expect(texts).toEqual(expect.arrayContaining(['70', '30']))
    expect(texts).toEqual(expect.arrayContaining(['O 128.00', 'H 131.00', 'L 126.00', 'C 129.00']))
    expect(texts.some((t) => t.startsWith('EMA 20 '))).toBe(true)
    expect(texts.some((t) => t.startsWith('RSI 14 '))).toBe(true)
  })

  it('keeps the price axis labels apart, the last price over the grid', () => {
    const { paint, placed } = setup()
    // A last close of 125 lands about 3 px from the top grid line (124.39).
    useMarketStore.setState({ candles: candles([...thirty.slice(0, 29), 125]) })
    paint()
    const axis = placed.filter((p) => p.x > 520 && /^[\d,]+\.\d\d$/.test(p.text)).map((p) => p.y).sort((a, b) => a - b)
    expect(axis.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < axis.length; i++) expect(axis[i] - axis[i - 1]).toBeGreaterThanOrEqual(14)
  })

  it('shows the candle under the pointer in the legend, newest candles on the right', () => {
    const { canvas, paint, texts } = setup()
    useMarketStore.setState({ candles: candles(thirty) })
    paint()

    // 30 candles in 14 px slots, right-aligned in a 508 px plot that starts at x = 12.
    hover(canvas, 12 + 508 - 29.5 * 14)
    paint()
    expect(texts).toContain('C 100.00')

    fireEvent.pointerLeave(canvas)
    paint()
    expect(texts).toContain('C 129.00')
  })

  it('leaves EMA and RSI out until there are enough candles', () => {
    const { paint, texts } = setup()
    useMarketStore.setState({ candles: candles([100, 101, 102, 103, 104]) })
    paint()
    expect(texts).toContain('C 104.00')
    expect(texts.some((t) => t.startsWith('EMA') || t.startsWith('RSI'))).toBe(false)
  })

  it('paints at most once per animation frame, and only when the candles change', () => {
    const { canvas, paint } = setup()
    paint()
    useMarketStore.setState({ candles: candles(thirty) })
    useMarketStore.setState({ candles: candles(thirty) })
    expect(pendingFrames()).toBe(1)
    paint()
    expect(canvas.dataset.draws).toBe('2')

    useMarketStore.setState({ fps: 60 })
    expect(pendingFrames()).toBe(0)
  })
})
