import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { symbolInfoQuery } from './api/binance'
import { FlowStrip } from './components/FlowStrip'
import { ChartPanel } from './components/ChartPanel'
import { MarketList } from './components/MarketList'
import { OrderBookPanel } from './components/OrderBookPanel'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { TradeTape } from './components/TradeTape'
import { marketClient } from './market/client'
import { useMarketStore } from './market/store'

export function App() {
  const symbol = useMarketStore((s) => s.symbol)
  const info = useQuery(symbolInfoQuery(symbol))
  const tickSize = info.data?.tickSize

  // The feed needs the tick size (grouping, synthetic prices), so it starts once that is known.
  useEffect(() => {
    if (tickSize !== undefined) marketClient.start(symbol, tickSize)
  }, [symbol, tickSize])

  useEffect(() => () => marketClient.stop(), [])

  return (
    <div className="terminal">
      <TopBar />
      <MarketList />
      <main className="center">
        {info.isError ? (
          <div className="panel error" role="alert">
            <p>Couldn't load {symbol} market details, so the live feed hasn't started.</p>
            <button type="button" onClick={() => info.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <ChartPanel />
            <FlowStrip />
            <TradeTape />
          </>
        )}
      </main>
      <OrderBookPanel />
      <StatusBar />
    </div>
  )
}
