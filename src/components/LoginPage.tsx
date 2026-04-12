import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const PASSCODE = 'AFCChurch'

export default function LoginPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code === PASSCODE) {
      sessionStorage.setItem('authenticated', 'true')
      navigate('/')
    } else {
      setError('Invalid passcode')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-center mb-6">
          AFC Neighborhood Watch
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-red-600 text-sm text-center">{error}</p>
          )}
          <div>
            <label
              htmlFor="passcode"
              className="block text-sm font-medium text-gray-700"
            >
              Passcode
            </label>
            <input
              id="passcode"
              type="password"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  )
}
