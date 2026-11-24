import { describe, expect, it } from 'vitest'
import { klineStream, parseStreamMessage, streamUrl } from './binance'

describe('streamUrl', () => {
  it('subscribes to depth, trades, the mini ticker and klines on one combined stream', () => {
    expect(streamUrl('wss://host', 'BTCUSDT', '5m')).toBe(
      'wss://host/stream?streams=btcusdt@depth@100ms/btcusdt@trade/btcusdt@miniTicker/btcusdt@kline_5m',
    )
  })

  it('names the kline stream for a symbol and interval', () => {
    expect(klineStream('ETHUSDT', '1h')).toBe('ethusdt@kline_1h')
  })
})

describe('parseStreamMessage', () => {
  it('unwraps the events the terminal handles', () => {
    for (const data of [
      { e: 'depthUpdate', E: 1, s: 'BTCUSDT', U: 1, u: 2, b: [], a: [] },
      { e: 'trade', E: 1, s: 'BTCUSDT', t: 1, p: '1', q: '1', T: 1, m: false },
      { e: '24hrMiniTicker', E: 1, s: 'BTCUSDT', c: '1', o: '1', h: '1', l: '1', v: '1', q: '1' },
      { e: 'kline', E: 1, s: 'BTCUSDT', k: { t: 0, T: 59_999, s: 'BTCUSDT', i: '1m', o: '1', c: '2', h: '3', l: '0.5', v: '4', x: false } },
    ]) {
      expect(parseStreamMessage(JSON.stringify({ stream: 'x', data }))).toEqual(data)
    }
  })

  it.each([
    ['broken JSON', '{"stream":'],
    ['a bare value', '42'],
    ['null', 'null'],
    ['a subscription reply', '{"result":null,"id":1}'],
    ['data that is not an object', '{"stream":"x","data":"hi"}'],
    ['data without an event type', '{"stream":"x","data":{"s":"BTCUSDT"}}'],
    ['an event it does not handle', '{"stream":"x","data":{"e":"aggTrade"}}'],
  ])('returns null for %s', (_, text) => {
    expect(parseStreamMessage(text)).toBeNull()
  })
})
