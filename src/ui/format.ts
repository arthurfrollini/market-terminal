// Intl.NumberFormat construction is slow; at 60fps it has to be cached.
const fixedCache = new Map<number, Intl.NumberFormat>()

export function formatFixed(value: number, decimals: number): string {
  let f = fixedCache.get(decimals)
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    fixedCache.set(decimals, f)
  }
  return f.format(value)
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

export function formatCompact(value: number): string {
  return compact.format(value)
}

export function formatPct(value: number, decimals = 2): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(decimals)}%`
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** Local HH:MM:SS.mmm — trades often share a second. */
export function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** Decimals that keep a quantity readable without printing 8 trailing zeros. */
export function qtyDecimals(stepDecimals: number): number {
  return Math.min(stepDecimals, 5)
}
