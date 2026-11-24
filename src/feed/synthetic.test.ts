import { describe, expect, it } from 'vitest'
import { SyntheticFeed, mulberry32 } from './synthetic'

interface Kline { t: number; i: string; o: string; h: string; l: string; c: string; v: string }

function setup() {
  let now = 10_000
  const messages: { stream: string; data: { e: string; T?: number; q?: string; k?: Kline } }[] = []
  const feed = new SyntheticFeed({
    symbol: 'BTCUSDT',
    midPrice: 60_000,
    tickSize: 0.01,
    messagesPerSecond: 5_000,
    onMessage: (text) => messages.push(JSON.parse(text)),
    random: mulberry32(7),
    now: () => now,
  })
  const run = (until: number) => {
    for (; now < until; now += 10) feed.tick()
  }
  const klines = () => messages.filter((m) => m.data.e === 'kline')
  return { feed, messages, run, klines }
}

describe('SyntheticFeed klines', () => {
  it('emits the whole current candle, built from its own trades', () => {
    const { run, messages, klines } = setup()
    run(12_000)
    const last = klines().at(-1)!
    expect(last.stream).toBe('btcusdt@kline_1m')
    const k = last.data.k!
    expect(k.t).toBe(0)
    expect(k.i).toBe('1m')
    const [o, h, l, c] = [k.o, k.h, k.l, k.c].map(Number)
    expect(h).toBeGreaterThanOrEqual(Math.max(o, c))
    expect(l).toBeLessThanOrEqual(Math.min(o, c))
    const traded = messages
      .filter((m) => m.data.e === 'trade' && m.data.T! < 60_000 && messages.indexOf(m) < messages.indexOf(last))
      .reduce((sum, m) => sum + Number(m.data.q), 0)
    expect(Number(k.v)).toBeCloseTo(traded, 4)
  })

  it('updates about twice a second', () => {
    const { run, klines } = setup()
    run(12_000)
    expect(klines().length).toBeGreaterThanOrEqual(4)
    expect(klines().length).toBeLessThanOrEqual(5)
  })

  it('opens a new candle when the bucket rolls over', () => {
    const { run, klines } = setup()
    run(61_000)
    expect(klines().at(-1)!.data.k!.t).toBe(60_000)
  })

  it('switches stream and bucket size with the interval', () => {
    const { feed, run, klines } = setup()
    run(11_000)
    feed.setInterval('5m')
    run(12_000)
    const last = klines().at(-1)!
    expect(last.stream).toBe('btcusdt@kline_5m')
    expect(last.data.k!.i).toBe('5m')
    expect(last.data.k!.t).toBe(0)
  })
})
