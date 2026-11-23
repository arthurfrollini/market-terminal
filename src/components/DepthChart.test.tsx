// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarketStore } from '../market/store'
import { FakeResizeObserver, animationFrame, liveBook, pendingFrames, renderWithMarket } from '../test/dom'
import { DepthChart } from './DepthChart'

/** Records what gets written on the canvas; every other 2D context call is a no-op. */
let texts: string[] = []
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key]
    if (key === 'fillText') return (text: string) => texts.push(text)
    if (key === 'measureText') return (text: string) => ({ width: text.length * 6 })
    return () => {}
  },
  set(target, key, value) {
    target[key] = value
    return true
  },
})

const book = liveBook(
  [[61_236, 1], [61_200, 2], [61_000, 3]],
  [[61_237, 1], [61_300, 4], [61_500, 2]],
)

function setup() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  renderWithMarket(<DepthChart />)
  const canvas = screen.getByTestId('depth-canvas') as HTMLCanvasElement
  act(() => FakeResizeObserver.all[0].resize(600, 300))
  return { canvas, paint: () => act(() => animationFrame()) }
}

function hover(canvas: HTMLCanvasElement, offsetX: number) {
  const event = new MouseEvent('pointermove')
  Object.defineProperty(event, 'offsetX', { value: offsetX })
  fireEvent(canvas, event)
}

beforeEach(() => {
  texts = []
})

describe('DepthChart', () => {
  it('sizes the canvas for the device pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const { canvas } = setup()
    expect([canvas.width, canvas.height]).toEqual([1200, 600])
  })

  it('waits for a live book', () => {
    const { paint } = setup()
    paint()
    expect(texts).toEqual(['Waiting for the order book'])
  })

  it('draws the mid price and the axes once the book is live', () => {
    const { canvas, paint } = setup()
    useMarketStore.setState({ book })
    paint()
    expect(texts).toContain('61,236.50')
    expect(texts.filter((t) => /^\d/.test(t))).toHaveLength(9) // 4 size labels, 4 prices, the mid
    expect(canvas.dataset.draws).toBe('1') // the resize and the book share one frame
  })

  it('paints at most once per animation frame, and only when something changed', () => {
    const { canvas, paint } = setup()
    paint()
    useMarketStore.setState({ book })
    useMarketStore.setState({ book: { ...book } })
    expect(pendingFrames()).toBe(1)
    paint()
    expect(canvas.dataset.draws).toBe('2')

    useMarketStore.setState({ fps: 60 })
    expect(pendingFrames()).toBe(0)
  })

  it('shows the depth under the pointer, bids left of the mid and asks right of it', () => {
    const { canvas, paint } = setup()
    useMarketStore.setState({ book })
    paint()

    hover(canvas, 100)
    texts = []
    paint()
    expect(texts.some((t) => t.endsWith('BTC bid down to here'))).toBe(true)

    hover(canvas, 500)
    texts = []
    paint()
    expect(texts.some((t) => t.endsWith('BTC offered up to here'))).toBe(true)

    fireEvent.pointerLeave(canvas)
    texts = []
    paint()
    expect(texts.some((t) => t.includes('here'))).toBe(false)
  })

  it('stops painting after unmount', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    const { unmount } = renderWithMarket(<DepthChart />)
    unmount()
    expect(FakeResizeObserver.all[0].disconnected).toBe(true)
    useMarketStore.setState({ book })
    expect(pendingFrames()).toBe(0)
  })
})
