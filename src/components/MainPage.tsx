import { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { doc, setDoc } from 'firebase/firestore'
import { db, functions } from '../firebase'
import { useSales } from '../hooks/useSales'
import { useEmailConfig } from '../hooks/useEmailConfig'
import MapView from './MapView'
import { formatDate, titleCase } from '../utils/formatters'

const CHURCH_LAT = 41.7322
const CHURCH_LON = -93.6295
const CHURCH_NAME = 'Ankeny First Church'

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

export default function MainPage() {
  const [radiusMiles, setRadiusMiles] = useState(3)
  const [timeframeMonths, setTimeframeMonths] = useState(1)
  const { sales, loading: salesLoading } = useSales(timeframeMonths, radiusMiles)
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Email report settings
  const { emailConfig, loading: emailLoading } = useEmailConfig()
  const [emailAddress, setEmailAddress] = useState('')
  const [emailSchedule, setEmailSchedule] = useState<
    'weekly' | 'monthly' | 'quarterly' | 'biannual'
  >('weekly')
  const [emailTimeframe, setEmailTimeframe] = useState(1)
  const [emailRadius, setEmailRadius] = useState(3)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailSaved, setEmailSaved] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<string | null>(null)

  useEffect(() => {
    if (!emailLoading) {
      setEmailAddress(emailConfig.recipientEmail)
      setEmailSchedule(emailConfig.schedule)
      setEmailTimeframe(emailConfig.timeframeMonths)
      setEmailRadius(emailConfig.radiusMiles)
      setEmailEnabled(emailConfig.enabled)
    }
  }, [emailConfig, emailLoading])

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

  async function handleSaveEmail() {
    setSavingEmail(true)
    setEmailSaved(false)
    try {
      await setDoc(doc(db, 'config', 'email'), {
        recipientEmail: emailAddress,
        schedule: emailSchedule,
        timeframeMonths: emailTimeframe,
        radiusMiles: emailRadius,
        enabled: emailEnabled,
      })
      setEmailSaved(true)
      setTimeout(() => setEmailSaved(false), 3000)
    } finally {
      setSavingEmail(false)
    }
  }

  async function handleTestEmail() {
    setTestingEmail(true)
    setTestEmailResult(null)
    try {
      const sendTest = httpsCallable<
        { recipientEmail: string; timeframeMonths: number; radiusMiles: number },
        { success: boolean }
      >(functions, 'sendTestEmail')
      await sendTest({
        recipientEmail: emailAddress,
        timeframeMonths: emailTimeframe,
        radiusMiles: emailRadius,
      })
      setTestEmailResult('Test email sent! Check your inbox.')
    } catch {
      setTestEmailResult('Failed to send test email. Check SMTP settings.')
    } finally {
      setTestingEmail(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">
          AFC Neighborhood Watch
        </h1>

        {/* Controls bar */}
        <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Radius:
            </label>
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.5}
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-gray-600 w-12">
              {radiusMiles} mi
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">
              Timeframe:
            </label>
            <select
              value={timeframeMonths}
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
          churchLat={CHURCH_LAT}
          churchLon={CHURCH_LON}
          churchName={CHURCH_NAME}
          radiusMiles={radiusMiles}
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
              {radiusMiles} miles
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

        {/* Email Report Settings */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-sm font-bold text-gray-800 mb-3">
            Scheduled Email Reports
          </h2>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailEnabled}
                  onChange={(e) => setEmailEnabled(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">Enabled</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Send to:
                </label>
                <input
                  type="text"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  placeholder="email1@example.com, email2@example.com"
                  className="text-sm rounded border border-gray-300 px-2 py-1 w-80 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Every:
                </label>
                <select
                  value={emailSchedule}
                  onChange={(e) =>
                    setEmailSchedule(
                      e.target.value as
                        | 'weekly'
                        | 'monthly'
                        | 'quarterly'
                        | 'biannual'
                    )
                  }
                  className="text-sm rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                >
                  <option value="weekly">Week (Monday)</option>
                  <option value="monthly">Month (1st)</option>
                  <option value="quarterly">3 Months</option>
                  <option value="biannual">6 Months</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Timeframe:
                </label>
                <select
                  value={emailTimeframe}
                  onChange={(e) => setEmailTimeframe(Number(e.target.value))}
                  className="text-sm rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                >
                  <option value={1}>1 month</option>
                  <option value={2}>2 months</option>
                  <option value={3}>3 months</option>
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Radius:
                </label>
                <select
                  value={emailRadius}
                  onChange={(e) => setEmailRadius(Number(e.target.value))}
                  className="text-sm rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                >
                  <option value={1}>1 mi</option>
                  <option value={2}>2 mi</option>
                  <option value={3}>3 mi</option>
                  <option value={4}>4 mi</option>
                  <option value={5}>5 mi</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveEmail}
                disabled={savingEmail}
                className="bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {savingEmail ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleTestEmail}
                disabled={testingEmail || !emailAddress}
                className="bg-gray-600 text-white px-4 py-1.5 rounded hover:bg-gray-700 disabled:opacity-50 text-sm"
              >
                {testingEmail ? 'Sending...' : 'Send Test Email'}
              </button>
              {emailSaved && (
                <span className="text-sm text-green-600">Saved!</span>
              )}
              {testEmailResult && (
                <span
                  className={`text-sm ${testEmailResult.includes('sent') ? 'text-green-600' : 'text-red-600'}`}
                >
                  {testEmailResult}
                </span>
              )}
            </div>

            <p className="text-xs text-gray-400">
              Note: Report emails may land in your spam/junk folder. If so, mark the email as "Not Spam" and add schleichertylerd@gmail.com to your contacts to ensure future reports arrive in your inbox.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
