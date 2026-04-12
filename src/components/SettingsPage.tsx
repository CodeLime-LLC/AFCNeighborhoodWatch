import { useState, useEffect } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useConfig } from '../hooks/useConfig'

export default function SettingsPage() {
  const { config, loading } = useConfig()
  const [address, setAddress] = useState('')
  const [churchName, setChurchName] = useState('')
  const [radiusMiles, setRadiusMiles] = useState(3)
  const [timeframeMonths, setTimeframeMonths] = useState(1)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeResult, setGeocodeResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)

  useEffect(() => {
    if (!loading) {
      setAddress(config.address)
      setChurchName(config.churchName)
      setRadiusMiles(config.radiusMiles)
      setTimeframeMonths(config.timeframeMonths)
      setLat(config.lat)
      setLon(config.lon)
    }
  }, [config, loading])

  async function handleGeocode() {
    setGeocoding(true)
    setGeocodeResult(null)
    try {
      const geocodeAddress = httpsCallable<
        { address: string },
        { lat: number; lon: number; matchedAddress: string }
      >(functions, 'geocodeAddressFn')
      const result = await geocodeAddress({ address })
      setLat(result.data.lat)
      setLon(result.data.lon)
      setGeocodeResult(`Matched: ${result.data.matchedAddress}`)
    } catch {
      setGeocodeResult('Geocoding failed. Check the address and try again.')
    } finally {
      setGeocoding(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await setDoc(
        doc(db, 'config', 'church'),
        {
          churchName,
          address,
          lat,
          lon,
          radiusMiles,
          timeframeMonths,
          jurisdictionCode: config.jurisdictionCode,
        },
        { merge: true }
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading settings...</p>
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-4">Settings</h2>
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Church Name
          </label>
          <input
            type="text"
            value={churchName}
            onChange={(e) => setChurchName(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Church Address
          </label>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="flex-1 rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleGeocode}
              disabled={geocoding || !address}
              className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 disabled:opacity-50 text-sm"
            >
              {geocoding ? 'Geocoding...' : 'Geocode'}
            </button>
          </div>
          {geocodeResult && (
            <p className="text-sm mt-1 text-gray-600">{geocodeResult}</p>
          )}
          {lat != null && lon != null && (
            <p className="text-xs mt-1 text-gray-400">
              Coordinates: {lat.toFixed(4)}, {lon.toFixed(4)}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Search Radius: {radiusMiles} miles
          </label>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={radiusMiles}
            onChange={(e) => setRadiusMiles(Number(e.target.value))}
            className="mt-1 w-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>0.5 mi</span>
            <span>5 mi</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Timeframe
          </label>
          <select
            value={timeframeMonths}
            onChange={(e) => setTimeframeMonths(Number(e.target.value))}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          >
            <option value={1}>Last 1 month</option>
            <option value={2}>Last 2 months</option>
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
          </select>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
