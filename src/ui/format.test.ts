import { describe, expect, it } from 'vitest'
import { formatClock, formatCompact, formatFixed, formatPct, formatTime, qtyDecimals } from './format'

describe('format', () => {
  it('formats prices with grouping and a fixed number of decimals', () => {
    expect(formatFixed(61236.5, 2)).toBe('61,236.50')
    expect(formatFixed(0.05556, 5)).toBe('0.05556')
    expect(formatFixed(1.23456, 2)).toBe('1.23')
    expect(formatFixed(61236.5, 2)).toBe('61,236.50')
  })

  it('formats volumes compactly', () => {
    expect(formatCompact(968_790_000)).toBe('968.79M')
    expect(formatCompact(1_250)).toBe('1.25K')
  })

  it('signs percentages with a plus or a minus sign', () => {
    expect(formatPct(0.964)).toBe('+0.96%')
    expect(formatPct(-21.3, 1)).toBe('−21.3%')
    expect(formatPct(0)).toBe('0.00%')
  })

  it('shows local time down to the millisecond', () => {
    expect(formatTime(new Date(2026, 10, 23, 9, 4, 5, 7).getTime())).toBe('09:04:05.007')
    expect(formatClock(new Date(2026, 10, 23, 9, 4, 5, 7).getTime())).toBe('09:04')
  })

  it('caps quantity decimals at 5', () => {
    expect(qtyDecimals(2)).toBe(2)
    expect(qtyDecimals(8)).toBe(5)
  })
})
