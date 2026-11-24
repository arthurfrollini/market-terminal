import { useEffect } from 'react'
import { useMarketStore } from '../market/store'
import type { CandleFrame } from '../market/types'
import { formatClock, formatCompact, formatFixed } from '../ui/format'
import { useCanvasPainter, type CanvasView, type Palette } from '../ui/useCanvasPainter'
import { useSymbolInfo } from '../ui/useSymbolInfo'

const PAD = { top: 12, right: 80, bottom: 24, left: 12 }
const FONT = '11px "Geist Mono", ui-monospace, monospace'
/** Candle slot width bounds: dense enough to show history, not so wide that few candles look odd. */
const MIN_SLOT = 6
const MAX_SLOT = 14
const RSI_SHARE = 0.22
const PANE_GAP = 10
const TIME_LABEL_SPACING = 80
/** Grid labels closer than this to the last price label are skipped. */
const LABEL_CLEARANCE = 14

interface DrawState extends CanvasView {
  priceDecimals: number
}

function draw(ctx: CanvasRenderingContext2D, candles: CandleFrame | null, s: DrawState, c: Palette): void {
  const { width, height } = s
  ctx.clearRect(0, 0, width, height)
  ctx.font = FONT
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  if (plotW <= 0 || plotH <= 0) return

  const n = candles?.time.length ?? 0
  if (!candles || n === 0) {
    ctx.fillStyle = c.muted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Waiting for candles', width / 2, height / 2)
    return
  }
  const { time, open, high, low, close, volume, ema, rsi } = candles

  // Newest candle on the right edge; only as many as fit at the minimum slot width.
  const visible = Math.min(n, Math.max(1, Math.floor(plotW / MIN_SLOT)))
  const first = n - visible
  const slot = Math.min(MAX_SLOT, plotW / visible)
  const right = PAD.left + plotW
  const cx = (i: number) => right - (n - i - 0.5) * slot

  const rsiH = Math.round(plotH * RSI_SHARE)
  const priceH = plotH - rsiH - PANE_GAP
  const rsiTop = PAD.top + priceH + PANE_GAP

  let lo = Infinity
  let hi = -Infinity
  for (let i = first; i < n; i++) {
    lo = Math.min(lo, low[i], Number.isFinite(ema[i]) ? ema[i] : Infinity)
    hi = Math.max(hi, high[i], Number.isFinite(ema[i]) ? ema[i] : -Infinity)
  }
  const span = hi - lo || hi * 0.02 || 1
  lo -= span * 0.05
  hi += span * 0.05
  const y = (p: number) => PAD.top + priceH - ((p - lo) / (hi - lo)) * priceH
  const last = close[n - 1]
  const lastUp = last >= open[n - 1]
  const ly = Math.round(y(last)) + 0.5
  const ry = (v: number) => rsiTop + (1 - v / 100) * rsiH

  // Price grid with labels on the right edge.
  ctx.lineWidth = 1
  ctx.strokeStyle = c.grid
  ctx.fillStyle = c.muted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (let k = 1; k <= 4; k++) {
    const p = lo + ((hi - lo) * k) / 5
    const gy = Math.round(y(p)) + 0.5
    ctx.beginPath()
    ctx.moveTo(PAD.left, gy)
    ctx.lineTo(right, gy)
    ctx.stroke()
    if (Math.abs(gy - ly) >= LABEL_CLEARANCE) ctx.fillText(formatFixed(p, s.priceDecimals), right + 8, gy)
  }

  // RSI pane: 30 and 70 levels.
  ctx.setLineDash([3, 4])
  for (const level of [70, 30]) {
    const gy = Math.round(ry(level)) + 0.5
    ctx.beginPath()
    ctx.moveTo(PAD.left, gy)
    ctx.lineTo(right, gy)
    ctx.stroke()
    ctx.fillText(String(level), right + 8, gy)
  }
  ctx.setLineDash([])
  ctx.strokeRect(PAD.left + 0.5, rsiTop + 0.5, plotW - 1, rsiH - 1)

  // Candles.
  const bodyW = Math.max(1, Math.floor(slot * 0.7))
  for (let i = first; i < n; i++) {
    const up = close[i] >= open[i]
    const x = Math.round(cx(i))
    ctx.strokeStyle = ctx.fillStyle = up ? c.bid : c.ask
    ctx.beginPath()
    ctx.moveTo(x + 0.5, y(high[i]))
    ctx.lineTo(x + 0.5, y(low[i]))
    ctx.stroke()
    const top = y(Math.max(open[i], close[i]))
    const bottom = y(Math.min(open[i], close[i]))
    ctx.fillRect(x - Math.floor(bodyW / 2), top, bodyW, Math.max(1, bottom - top))
  }

  // A line through the finite values, broken where a value is NaN (before warm-up).
  const line = (values: Float64Array, map: (v: number) => number) => {
    ctx.beginPath()
    let drawing = false
    for (let i = first; i < n; i++) {
      if (!Number.isFinite(values[i])) {
        drawing = false
        continue
      }
      if (drawing) ctx.lineTo(cx(i), map(values[i]))
      else ctx.moveTo(cx(i), map(values[i]))
      drawing = true
    }
    ctx.stroke()
  }
  ctx.lineWidth = 1.25
  ctx.strokeStyle = c.text
  ctx.globalAlpha = 0.7
  line(ema, y)
  line(rsi, ry)
  ctx.globalAlpha = 1
  ctx.lineWidth = 1

  // Last price: dashed line and a label on the axis.
  ctx.strokeStyle = lastUp ? c.bid : c.ask
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(PAD.left, ly)
  ctx.lineTo(right, ly)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = c.panel
  ctx.fillRect(right + 2, ly - 8, PAD.right - 2, 16)
  ctx.fillStyle = lastUp ? c.bid : c.ask
  ctx.fillText(formatFixed(last, s.priceDecimals), right + 8, ly)

  // Time axis.
  ctx.fillStyle = c.muted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const every = Math.max(1, Math.ceil(TIME_LABEL_SPACING / slot))
  for (let i = n - 1 - Math.floor(every / 2); i >= first; i -= every) {
    ctx.fillText(formatClock(time[i]), cx(i), PAD.top + plotH + 6)
  }

  // Crosshair on the candle under the pointer.
  let shown = n - 1
  if (s.hoverX !== null && s.hoverX >= PAD.left && s.hoverX <= right) {
    const i = n - 1 - Math.floor((right - s.hoverX) / slot)
    if (i >= first) {
      shown = i
      const x = Math.round(cx(i)) + 0.5
      ctx.strokeStyle = c.text
      ctx.globalAlpha = 0.4
      ctx.beginPath()
      ctx.moveTo(x, PAD.top)
      ctx.lineTo(x, PAD.top + plotH)
      if (s.hoverY !== null && s.hoverY >= PAD.top && s.hoverY <= PAD.top + priceH) {
        ctx.moveTo(PAD.left, Math.round(s.hoverY) + 0.5)
        ctx.lineTo(right, Math.round(s.hoverY) + 0.5)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
      if (s.hoverY !== null && s.hoverY >= PAD.top && s.hoverY <= PAD.top + priceH) {
        const p = lo + ((PAD.top + priceH - s.hoverY) / priceH) * (hi - lo)
        ctx.fillStyle = c.panel
        ctx.fillRect(right + 2, s.hoverY - 8, PAD.right - 2, 16)
        ctx.fillStyle = c.text
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(formatFixed(p, s.priceDecimals), right + 8, s.hoverY)
      }
    }
  }

  // Legend for the hovered candle, or the latest one.
  const fmt = (v: number) => formatFixed(v, s.priceDecimals)
  const up = close[shown] >= open[shown]
  const legend = (items: [string, string][], x: number, top: number) => {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    for (const [text, color] of items) {
      ctx.fillStyle = color
      ctx.fillText(text, x, top)
      x += ctx.measureText(text).width + 10
    }
  }
  const tone = up ? c.bid : c.ask
  const priceItems: [string, string][] = [
    [formatClock(time[shown]), c.muted],
    [`O ${fmt(open[shown])}`, tone],
    [`H ${fmt(high[shown])}`, tone],
    [`L ${fmt(low[shown])}`, tone],
    [`C ${fmt(close[shown])}`, tone],
    [`Vol ${formatCompact(volume[shown])}`, c.muted],
  ]
  if (Number.isFinite(ema[shown])) priceItems.push([`EMA 20 ${fmt(ema[shown])}`, c.text])
  legend(priceItems, PAD.left + 6, PAD.top + 4)
  if (Number.isFinite(rsi[shown])) legend([[`RSI 14 ${rsi[shown].toFixed(1)}`, c.text]], PAD.left + 6, rsiTop + 4)
}

/** Painted outside React, redrawn only when the candles change or the pointer moves. */
export function CandleChart() {
  const { priceDecimals } = useSymbolInfo()
  const { canvasRef, requestDraw } = useCanvasPainter(
    (ctx, view, palette) => draw(ctx, useMarketStore.getState().candles, { ...view, priceDecimals }, palette),
    (s, prev) => s.candles !== prev.candles,
  )

  useEffect(requestDraw, [priceDecimals, requestDraw])

  return (
    <canvas
      ref={canvasRef}
      className="chart-canvas"
      data-testid="candle-canvas"
      role="img"
      aria-label="Price candles with EMA 20 and RSI 14"
    />
  )
}
