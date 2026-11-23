/** Fixed-capacity buffer that overwrites the oldest item. `at(0)` is the newest. */
export class RingBuffer<T> {
  readonly capacity: number
  private readonly items: (T | undefined)[]
  private head = 0
  private count = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.items = new Array(capacity)
  }

  get length(): number {
    return this.count
  }

  push(item: T): void {
    this.items[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  pushMany(items: readonly T[]): void {
    const start = Math.max(0, items.length - this.capacity)
    for (let i = start; i < items.length; i++) this.push(items[i])
  }

  at(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined
    return this.items[(this.head - 1 - index + this.capacity) % this.capacity]
  }

  clear(): void {
    this.items.fill(undefined)
    this.head = 0
    this.count = 0
  }
}
