import { describe, expect, it } from 'vitest'
import { parseStreamMessage, streamUrl } from './binance'

describe('streamUrl', () => {
  it('subscribes to depth, trades and the mini ticker on one combined stream', () => {
    expect(streamUrl('wss://host', 'BTCUSDT')).toBe(
      'wss://host/stream?streams=btcusdt@depth@100ms/btcusdt@trade/btcusdt@miniTicker',
    )
  })
})

describe('parseStreamMessage', () => {
  it('unwraps the events the terminal handles', () => {
    for (const data of [
      { e: 'depthUpdate', E: 1, s: 'BTCUSDT', U: 1, u: 2, b: [], a: [] },
      { e: 'trade', E: 1, s: 'BTCUSDT', t: 1, p: '1', q: '1', T: 1, m: false },
      { e: '24hrMiniTicker', E: 1, s: 'BTCUSDT', c: '1', o: '1', h: '1', l: '1', v: '1', q: '1' },
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
    ['an event it does not handle', '{"stream":"x","data":{"e":"kline"}}'],
  ])('returns null for %s', (_, text) => {
    expect(parseStreamMessage(text)).toBeNull()
  })
})
