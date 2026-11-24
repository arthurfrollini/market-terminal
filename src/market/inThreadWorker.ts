import { createMarketHost, type MarketHost } from '../worker/host'
import type { FromWorker, ToWorker } from './types'

/**
 * The worker's code on the main thread, behind the same messages. Only for `?engine=main`, which
 * exists to measure what the Web Worker saves. A MessageChannel keeps delivery asynchronous and
 * structured-cloned, as with a real worker, so the only difference is the thread doing the work.
 */
export class InThreadWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null
  private readonly channel = new MessageChannel()
  private readonly host: MarketHost

  constructor() {
    const { port1, port2 } = this.channel
    this.host = createMarketHost((msg, transfer) => port2.postMessage(msg, transfer))
    port2.onmessage = (e: MessageEvent<ToWorker>) => this.host.handle(e.data)
    port1.onmessage = (e: MessageEvent<FromWorker>) => this.onmessage?.(e)
  }

  postMessage(msg: ToWorker): void {
    this.channel.port1.postMessage(msg)
  }

  terminate(): void {
    this.host.stop()
    this.channel.port1.close()
    this.channel.port2.close()
  }
}
