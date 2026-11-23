import { test as base } from '@playwright/test'
import { MockBinance } from './mockBinance'

export const test = base.extend<{ mock: MockBinance }>({
  mock: async ({ page }, provide) => {
    const mock = new MockBinance()
    await mock.start()
    // Keep runs hermetic: no font CDN.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
    await provide(mock)
    await mock.stop()
  },
})

export { expect } from '@playwright/test'
