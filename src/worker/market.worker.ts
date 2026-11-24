import type { FromWorker, ToWorker } from '../market/types'
import { createMarketHost } from './host'

// The socket lives here, not on the main thread: JSON parsing, book upkeep and aggregation
// never compete with React rendering or canvas painting.

// Typed locally: pulling in the `webworker` lib clashes with `DOM` in the shared tsconfig.
const scope = self as unknown as {
  postMessage(msg: FromWorker, transfer: Transferable[]): void
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
}

const host = createMarketHost((msg, transfer) => scope.postMessage(msg, transfer))
scope.onmessage = (e) => host.handle(e.data)
