import { useEffect } from 'react'
import { useMarketStore } from '../market/store'
import type { BookFrame } from '../market/types'
import { formatCompact, formatFixed } from '../ui/format'
import { useCanvasPainter, type CanvasView, type Palette } from '../ui/useCanvasPainter'
import { useSymbolInfo } from '../ui/useSymbolInfo'

const PAD = { top: 16, right: 64, bottom: 28, left: 12 }
const FONT = '11px "Geist Mono", ui-monospace, monospace'

interface DrawState extends CanvasView {
  priceDecimals: number
  base: string
}

function draw(ctx: CanvasRenderingContext2D, book: BookFrame | null, s: DrawState, c: Palette): void {
  const { width, height } = s
  ctx.clearRect(0, 0, width, height)
  ctx.font = FONT
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  if (plotW <= 0 || plotH <= 0) return

  const { depth, mid } = book ?? {}
  if (!book || book.status !== 'live' || mid == null || !depth || depth.bids.cumulative.length === 0) {
    ctx.fillStyle = c.muted
    ctx.textAlign = 'center'
    ctx.fillText('Waiting for the order book', width / 2, height / 2)
    return
  }

  const lo = mid * (1 - depth.rangePct)
  const hi = mid * (1 + depth.rangePct)
  const n = depth.bids.cumulative.length
  const maxQty = Math.max(depth.bids.cumulative[n - 1], depth.asks.cumulative[n - 1]) * 1.08 || 1
  const x = (p: number) => PAD.left + ((p - lo) / (hi - lo)) * plotW
  const y = (q: number) => PAD.top + plotH - (q / maxQty) * plotH

  // Horizontal grid with quantity labels on the right edge.
  ctx.strokeStyle = c.grid
  ctx.lineWidth = 1
  ctx.fillStyle = c.muted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (let i = 1; i <= 4; i++) {
    const q = (maxQty / 4) * i
    const gy = Math.round(y(q)) + 0.5
    ctx.beginPath()
    ctx.moveTo(PAD.left, gy)
    ctx.lineTo(PAD.left + plotW, gy)
    ctx.stroke()
    ctx.fillText(formatCompact(q), PAD.left + plotW + 8, gy)
  }

  const side = (prices: Float64Array, cum: Float64Array, color: string) => {
    ctx.beginPath()
    ctx.moveTo(x(mid), y(0))
    let prev = 0
    for (let i = 0; i < prices.length; i++) {
      const px = x(prices[i])
      ctx.lineTo(px, y(prev))
      ctx.lineTo(px, y(cum[i]))
      prev = cum[i]
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.lineTo(x(prices[prices.length - 1]), y(0))
    ctx.closePath()
    ctx.globalAlpha = 0.16
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalAlpha = 1
  }
  side(depth.bids.prices, depth.bids.cumulative, c.bid)
  side(depth.asks.prices, depth.asks.cumulative, c.ask)

  // Mid line and price axis.
  const mx = Math.round(x(mid)) + 0.5
  ctx.setLineDash([3, 4])
  ctx.strokeStyle = c.muted
  ctx.beginPath()
  ctx.moveTo(mx, PAD.top)
  ctx.lineTo(mx, PAD.top + plotH)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  const axisY = PAD.top + plotH + 8
  for (const f of [0.1, 0.3, 0.7, 0.9]) {
    const p = lo + (hi - lo) * f
    ctx.fillStyle = c.muted
    ctx.fillText(formatFixed(p, s.priceDecimals), x(p), axisY)
  }
  ctx.fillStyle = c.text
  ctx.fillText(formatFixed(mid, s.priceDecimals), mx, axisY)

  if (s.hoverX !== null && s.hoverX >= PAD.left && s.hoverX <= PAD.left + plotW) {
    const p = lo + ((s.hoverX - PAD.left) / plotW) * (hi - lo)
    const isBid = p < mid
    const curve = isBid ? depth.bids : depth.asks
    const bucket = Math.min(n - 1, Math.max(0, Math.floor((Math.abs(p - mid) / (mid * depth.rangePct)) * n)))
    const qty = curve.cumulative[bucket]
    const hx = Math.round(s.hoverX) + 0.5
    ctx.strokeStyle = c.text
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.moveTo(hx, PAD.top)
    ctx.lineTo(hx, PAD.top + plotH)
    ctx.stroke()
    ctx.globalAlpha = 1

    const lines = [
      formatFixed(p, s.priceDecimals),
      `${formatFixed(qty, 3)} ${s.base} ${isBid ? 'bid down to here' : 'offered up to here'}`,
    ]
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16
    const boxH = 40
    const bx = Math.min(Math.max(hx + 10, PAD.left), PAD.left + plotW - boxW)
    const by = PAD.top + 4
    ctx.fillStyle = c.panel
    ctx.fillRect(bx, by, boxW, boxH)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = c.text
    ctx.fillText(lines[0], bx + 8, by + 7)
    ctx.fillStyle = isBid ? c.bid : c.ask
    ctx.fillText(lines[1], bx + 8, by + 22)
  }
}

/** Painted outside React, redrawn only when the book changes or the pointer moves. */
export function DepthChart() {
  const { priceDecimals, baseAsset } = useSymbolInfo()
  const { canvasRef, requestDraw } = useCanvasPainter(
    (ctx, view, palette) => draw(ctx, useMarketStore.getState().book, { ...view, priceDecimals, base: baseAsset }, palette),
    (s, prev) => s.book !== prev.book,
  )

  useEffect(requestDraw, [priceDecimals, baseAsset, requestDraw])

  return (
    <canvas
      ref={canvasRef}
      className="chart-canvas"
      data-testid="depth-canvas"
      role="img"
      aria-label="Cumulative bid and ask depth within 0.5% of mid"
    />
  )
}
