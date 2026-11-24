import { afterEach, describe, expect, it, vi } from 'vitest'
import { InThreadWorker } from './inThreadWorker'
import type { FromWorker } from './types'

const start = { type: 'start', symbol: 'BTCUSDT', wsBase: 'wss://unused', grouping: 0.01, tickSize: 0.01, interval: '1m' } as const

let worker: InThreadWorker | null = null

function open() {
  worker = new InThreadWorker()
  const received: FromWorker[] = []
  worker.onmessage = (e) => received.push(e.data)
  // Simulated feed, so no socket is needed.
  worker.postMessage({ type: 'stress', enabled: true, messagesPerSecond: 1_000 })
  worker.postMessage(start)
  return { worker, received }
}

afterEach(() => {
  worker?.terminate()
  worker = null
})

describe('InThreadWorker', () => {
  it('runs the worker code on this thread behind the same messages', async () => {
    const { worker, received } = open()
    await vi.waitFor(() =>
      expect(received).toContainEqual({
        type: 'status',
        status: { state: 'open', attempt: 0, retryInMs: null, source: 'synthetic' },
      }),
    )
    worker.postMessage({ type: 'pull' })
    await vi.waitFor(() => expect(received.find((m) => m.type === 'frame')).toBeDefined())
    const frame = received.find((m) => m.type === 'frame')
    expect(frame?.type === 'frame' && frame.frame?.book?.status).toBe('live')
  })

  it('stops the feed on terminate', async () => {
    const { worker, received } = open()
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0))
    worker.terminate()
    const count = received.length
    worker.postMessage({ type: 'pull' })
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toHaveLength(count)
  })
})
