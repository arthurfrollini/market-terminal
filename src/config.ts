// Endpoint overrides (`?ws=…&rest=…`) only work in dev and in the e2e build, so a shared link
// can't point the production app at someone else's fake feed.
const allowOverride = import.meta.env.DEV || import.meta.env.VITE_ALLOW_ENDPOINT_OVERRIDE === 'true'
const params = new URLSearchParams(globalThis.location?.search ?? '')

function override(name: string): string | null {
  return allowOverride ? params.get(name) : null
}

/** Market-data-only hosts; unlike api.binance.com they are not geo-blocked for US visitors. */
export const REST_BASE = override('rest') ?? 'https://data-api.binance.vision'
export const WS_BASE = override('ws') ?? 'wss://data-stream.binance.vision'

export const SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'LTCUSDT',
  'TRXUSDT',
  'DOTUSDT',
] as const

const requested = params.get('symbol')?.toUpperCase()
export const DEFAULT_SYMBOL = requested && /^[A-Z0-9]{5,20}$/.test(requested) ? requested : 'BTCUSDT'
export const START_IN_STRESS = params.get('stress') === '1'
/** `?engine=main` runs the engine on the main thread instead of the Web Worker, to compare the two. */
export const ENGINE_THREAD: 'worker' | 'main' = params.get('engine') === 'main' ? 'main' : 'worker'

/** Binance allows up to 5000 levels; deep enough for the ±0.5% depth chart on majors. */
export const SNAPSHOT_LIMIT = 5000
export const TRADE_TAPE_CAPACITY = 10_000
export const STRESS_RATES = [1_000, 5_000, 20_000] as const
