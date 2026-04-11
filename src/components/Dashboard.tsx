import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { useConfig } from '../hooks/useConfig'
import { useSales } from '../hooks/useSales'
import MapView from './MapView'
import { formatDate, titleCase } from '../utils/formatters'

interface ProcessResult {
  newRecords: number
  totalInRadius: number
  errors: number
}

function exportToCsv(
  sales: { address: string; city: string; zip: string; buyer: string }[]
) {
  const headers = ['Name', 'Address', 'City', 'ZIP']
  const rows = sales.map((s) => [
    titleCase(s.buyer),
    titleCase(s.address),
    titleCase(s.city),
    s.zip,
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `new-movers-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Dashboard() {
  const { config, loading: configLoading } = useConfig()
  const [radiusMiles, setRadiusMiles] = useState<number | null>(null)
  const [timeframeMonths, setTimeframeMonths] = useState<number | null>(null)

  const activeRadius = radiusMiles ?? config.radiusMiles
  const activeTimeframe = timeframeMonths ?? config.timeframeMonths

  const { sales, loading: salesLoading } = useSales(
    activeTimeframe,
    activeRadius
  )
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  async function handleFetch() {
    setFetching(true)
    setFetchResult(null)
    setFetchError(null)
    try {
      const processSales = httpsCallable<void, ProcessResult>(
        functions,
        'processSales'
      )
      const result = await processSales()
      setFetchResult(
        `Found ${result.data.newRecords} new records. ${result.data.totalInRadius} total within radius.${result.data.errors > 0 ? ` (${result.data.errors} geocoding errors)` : ''}`
      )
    } catch {
      setFetchError('Failed to fetch data. Please try again.')
    } finally {
      setFetching(false)
    }
  }

  if (configLoading) {
    return <p className="text-gray-500">Loading...</p>
  }

  const needsSetup = !config.lat || !config.lon

  if (needsSetup) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center text-yellow-800">
        Please go to <strong>Settings</strong> and geocode your church address
        before using the map.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            Radius:
          </label>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={activeRadius}
            onChange={(e) => setRadiusMiles(Number(e.target.value))}
            className="w-24"
          />
          <span className="text-sm text-gray-600 w-12">
            {activeRadius} mi
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">
            Timeframe:
          </label>
          <select
            value={activeTimeframe}
            onChange={(e) => setTimeframeMonths(Number(e.target.value))}
            className="text-sm rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
          >
            <option value={1}>1 month</option>
            <option value={2}>2 months</option>
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
          </select>
        </div>

        <button
          onClick={handleFetch}
          disabled={fetching}
          className="bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          {fetching ? 'Fetching...' : 'Fetch New Data'}
        </button>

        {config.lastFetchDate && (
          <span className="text-xs text-gray-400 ml-auto">
            Last fetch: {formatDate(config.lastFetchDate)}
          </span>
        )}
      </div>

      {/* Status messages */}
      {fetchResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
          {fetchResult}
        </div>
      )}
      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {fetchError}
        </div>
      )}

      {/* Map */}
      <MapView
        churchLat={config.lat!}
        churchLon={config.lon!}
        churchName={config.churchName}
        radiusMiles={activeRadius}
        sales={sales}
      />

      {/* Results summary + export */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-700">
            <span className="font-bold text-lg text-gray-900">
              {salesLoading ? '...' : sales.length}
            </span>{' '}
            new mover{sales.length !== 1 ? 's' : ''} found within{' '}
            {activeRadius} miles
          </p>
          {sales.length > 0 && (
            <button
              onClick={() => exportToCsv(sales)}
              className="bg-gray-700 text-white px-4 py-1.5 rounded hover:bg-gray-800 text-sm"
            >
              Export CSV
            </button>
          )}
        </div>

        {sales.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    Name
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    Address
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">
                    Distance
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    Move Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5">{titleCase(sale.buyer)}</td>
                    <td className="px-3 py-1.5">
                      {titleCase(sale.address)}, {sale.zip}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-500">
                      {sale.distanceMiles?.toFixed(1)} mi
                    </td>
                    <td className="px-3 py-1.5 text-gray-500">
                      {formatDate(sale.saleDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
