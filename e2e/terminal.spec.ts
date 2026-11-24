import { expect, test } from './fixtures'
import { depthUpdate, tradeEvent } from './mockBinance'

const DEPTH = 'btcusdt@depth@100ms'
const TRADES = 'btcusdt@trade'

test.beforeEach(async ({ page, mock }) => {
  await page.goto(mock.appUrl())
  await expect(page.getByTestId('conn')).toHaveAttribute('data-state', 'open')
  await expect(page.getByTestId('order-book')).toHaveAttribute('data-status', 'live')
})

test('builds the book from the REST snapshot and applies diffs', async ({ page, mock }) => {
  const bestBid = page.getByTestId('bid-row').first()
  const bestAsk = page.getByTestId('ask-row').last()
  await expect(bestBid).toContainText('100.00')
  await expect(bestBid).toContainText('1.00000')
  await expect(bestAsk).toContainText('100.10')

  mock.send(DEPTH, depthUpdate('BTCUSDT', 101, 101, [['100.00', '5.00000']], [['100.10', '0']]))
  await expect(bestBid).toContainText('5.00000')
  await expect(page.getByTestId('ask-row').last()).toContainText('100.20')
  expect(mock.snapshotRequests('BTCUSDT')).toBe(1)
})

test('streams trades into the tape, newest first', async ({ page, mock }) => {
  mock.send(TRADES, tradeEvent('BTCUSDT', 1, '100.05', '0.25000'))
  mock.send(TRADES, tradeEvent('BTCUSDT', 2, '100.06', '0.50000', true))
  await expect(page.getByTestId('trade-count')).toHaveText('2 trades')
  const first = page.getByTestId('trade-row').first()
  await expect(first).toContainText('100.06')
  await expect(first).toHaveClass(/sell/)
})

test('reconnects after a network drop and resyncs the book', async ({ page, mock }) => {
  mock.dropAll()
  await expect.poll(() => mock.totalConnections).toBe(2)
  await expect(page.getByTestId('conn')).toHaveAttribute('data-state', 'open')
  await expect.poll(() => mock.snapshotRequests('BTCUSDT')).toBe(2)
  await expect(page.getByTestId('order-book')).toHaveAttribute('data-status', 'live')
})

test('the drop button exercises the same reconnect path', async ({ page, mock }) => {
  await page.getByTestId('drop').click()
  await expect.poll(() => mock.totalConnections).toBe(2)
  await expect(page.getByTestId('conn')).toHaveAttribute('data-state', 'open')
})

test('a sequence gap triggers a fresh snapshot', async ({ page, mock }) => {
  mock.setSnapshot('BTCUSDT', {
    lastUpdateId: 300,
    bids: [['99.50', '8.00000']],
    asks: [['100.50', '1.00000']],
  })
  mock.send(DEPTH, depthUpdate('BTCUSDT', 250, 251)) // expected U = 101
  await expect(page.getByTestId('resyncs')).toHaveText('1')
  await expect(page.getByTestId('bid-row').first()).toContainText('99.50')
  expect(mock.snapshotRequests('BTCUSDT')).toBe(2)
})

test('switching markets resubscribes to the new symbol', async ({ page, mock }) => {
  await page.getByTestId('market-ETHUSDT').click()
  await expect(page.getByTestId('symbol')).toHaveText('ETH/USDT')
  await expect.poll(() => mock.openStreams()).toEqual([
    ['ethusdt@depth@100ms', 'ethusdt@trade', 'ethusdt@miniTicker', 'ethusdt@kline_1m'],
  ])
  await expect(page.getByTestId('order-book')).toHaveAttribute('data-status', 'live')
  expect(mock.snapshotRequests('ETHUSDT')).toBe(1)
})

test('keeps thousands of trades but renders only the visible rows', async ({ page, mock }) => {
  for (let i = 1; i <= 3000; i++) mock.send(TRADES, tradeEvent('BTCUSDT', i, '100.05', '0.10000', i % 2 === 0))
  await expect(page.getByTestId('trade-count')).toHaveText('3,000 trades')
  const rendered = await page.getByTestId('trade-row').count()
  expect(rendered).toBeGreaterThan(5)
  expect(rendered).toBeLessThan(100)
})

test('stress mode switches to the simulated feed at high rate', async ({ page }) => {
  await page.getByTestId('stress-toggle').click()
  await expect(page.getByTestId('conn')).toHaveAttribute('data-source', 'synthetic')
  await expect
    .poll(async () => Number((await page.getByTestId('msgs-per-sec').textContent())?.replace(/,/g, '')))
    .toBeGreaterThan(1000)
  await expect(page.getByTestId('order-book')).toHaveAttribute('data-status', 'live')
  await expect.poll(async () => Number(await page.getByTestId('depth-canvas').getAttribute('data-draws'))).toBeGreaterThan(10)
})
