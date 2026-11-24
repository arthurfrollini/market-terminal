/** The subset of the browser WebSocket this class relies on, so tests can pass a fake. */
export interface SocketLike {
  onopen: ((ev: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  onclose: ((ev: CloseEvent) => void) | null
  onerror: ((ev: Event) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type SocketFactory = (url: string) => SocketLike

export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface SocketStatus {
  state: SocketState
  /** Consecutive failed attempts; resets once a message arrives. */
  attempt: number
  /** Delay before the next attempt, when one is scheduled. */
  retryInMs: number | null
}

export interface ReconnectingSocketOptions {
  url: string
  onMessage: (data: string) => void
  onOpen?: () => void
  onStatus?: (status: SocketStatus) => void
  createSocket?: SocketFactory
  baseDelayMs?: number
  maxDelayMs?: number
  /** Reconnect when nothing arrives for this long, even if the socket looks open. */
  staleAfterMs?: number
  random?: () => number
  now?: () => number
}

const defaultFactory: SocketFactory = (url) => new WebSocket(url)

/**
 * WebSocket with exponential backoff (equal jitter) and a silence watchdog.
 * A half-open TCP connection can look open for minutes, so liveness is judged by data, not by `readyState`.
 */
export class ReconnectingSocket {
  private readonly opts: Required<Omit<ReconnectingSocketOptions, 'onOpen' | 'onStatus'>> &
    Pick<ReconnectingSocketOptions, 'onOpen' | 'onStatus'>
  private socket: SocketLike | null = null
  private isOpen = false
  private url: string
  private attempt = 0
  private stopped = true
  private lastMessageAt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null

  constructor(options: ReconnectingSocketOptions) {
    this.opts = {
      createSocket: defaultFactory,
      baseDelayMs: 500,
      maxDelayMs: 15_000,
      staleAfterMs: 10_000,
      random: Math.random,
      now: Date.now,
      ...options,
    }
    this.url = options.url
  }

  connect(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempt = 0
    this.open()
  }

  close(): void {
    this.stopped = true
    this.clearTimers()
    this.detach()?.close(1000, 'client closed')
    this.emit('closed', null)
  }

  /** Kills the current connection as if the network dropped. Reconnection follows. */
  drop(): void {
    if (this.stopped || !this.socket) return
    this.detach()?.close(4001, 'dropped')
    this.scheduleReconnect()
  }

  /** Sends on the current connection. Returns false, and drops the message, when there is none. */
  send(data: string): boolean {
    if (!this.isOpen) return false
    this.socket!.send(data)
    return true
  }

  /** The URL for the next connection; the current one is left alone. */
  setUrl(url: string): void {
    this.url = url
  }

  /** Delay for a given attempt: half the capped exponential plus up to another half at random. */
  backoff(attempt: number): number {
    const cap = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** attempt)
    return cap / 2 + this.opts.random() * (cap / 2)
  }

  private open(): void {
    this.retryTimer = null
    this.emit(this.attempt === 0 ? 'connecting' : 'reconnecting', null)
    let socket: SocketLike
    try {
      socket = this.opts.createSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      this.isOpen = true
      this.lastMessageAt = this.opts.now()
      this.startWatchdog()
      this.emit('open', null)
      this.opts.onOpen?.()
    }
    socket.onmessage = (ev) => {
      this.lastMessageAt = this.opts.now()
      if (this.attempt !== 0) {
        this.attempt = 0
        this.emit('open', null)
      }
      this.opts.onMessage(typeof ev.data === 'string' ? ev.data : String(ev.data))
    }
    socket.onclose = () => {
      this.detach()
      this.scheduleReconnect()
    }
    // An error is always followed by close; reconnect is handled there.
    socket.onerror = () => {}
  }

  private scheduleReconnect(): void {
    this.stopWatchdog()
    if (this.stopped || this.retryTimer) return
    const delay = this.backoff(this.attempt)
    this.attempt++
    this.emit('reconnecting', delay)
    this.retryTimer = setTimeout(() => this.open(), delay)
  }

  private startWatchdog(): void {
    this.stopWatchdog()
    const { staleAfterMs } = this.opts
    this.watchdog = setInterval(() => {
      if (this.opts.now() - this.lastMessageAt <= staleAfterMs) return
      this.detach()?.close(4000, 'stale')
      this.scheduleReconnect()
    }, staleAfterMs / 4)
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
  }

  private clearTimers(): void {
    this.stopWatchdog()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  /** Unhooks the current socket so its late events can't trigger anything. */
  private detach(): SocketLike | null {
    const s = this.socket
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null
    }
    this.socket = null
    this.isOpen = false
    return s
  }

  private emit(state: SocketState, retryInMs: number | null): void {
    this.opts.onStatus?.({ state, attempt: this.attempt, retryInMs })
  }
}
