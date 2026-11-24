import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useMarketStore, type MarketState } from '../market/store'

export interface Palette {
  bid: string
  ask: string
  grid: string
  text: string
  muted: string
  panel: string
}

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return { bid: v('--bid'), ask: v('--ask'), grid: v('--line'), text: v('--text'), muted: v('--muted'), panel: v('--panel-raised') }
}

/** Canvas size in CSS pixels and the pointer position over it, if any. */
export interface CanvasView {
  width: number
  height: number
  hoverX: number | null
  hoverY: number | null
}

export type Paint = (ctx: CanvasRenderingContext2D, view: CanvasView, palette: Palette) => void

/**
 * Paints a canvas outside React: subscribes to the store directly and redraws on the next
 * animation frame only when `changed` says the data moved, the canvas resized or the pointer
 * moved. Handles the device pixel ratio. `data-draws` counts paints, for tests.
 */
export function useCanvasPainter(paint: Paint, changed: (s: MarketState, prev: MarketState) => boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ paint, changed })
  const schedule = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    latest.current = { paint, changed }
  })

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const palette = readPalette(canvas)
    const view: CanvasView = { width: 0, height: 0, hoverX: null, hoverY: null }
    let raf = 0
    let draws = 0

    const paintNow = () => {
      raf = 0
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      latest.current.paint(ctx, view, palette)
      canvas.dataset.draws = String(++draws)
    }
    const request = () => {
      if (!raf) raf = requestAnimationFrame(paintNow)
    }
    schedule.current = request

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const dpr = window.devicePixelRatio || 1
      view.width = width
      view.height = height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      request()
    })
    resize.observe(canvas)

    const unsubscribe = useMarketStore.subscribe((s, prev) => {
      if (latest.current.changed(s, prev)) request()
    })
    const onMove = (e: PointerEvent) => {
      view.hoverX = e.offsetX
      view.hoverY = e.offsetY
      request()
    }
    const onLeave = () => {
      view.hoverX = null
      view.hoverY = null
      request()
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      cancelAnimationFrame(raf)
      resize.disconnect()
      unsubscribe()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      schedule.current = () => {}
    }
  }, [])

  const requestDraw = useCallback(() => schedule.current(), [])
  return { canvasRef, requestDraw }
}
