import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export interface ChurchConfig {
  churchName: string
  address: string
  lat: number | null
  lon: number | null
  radiusMiles: number
  timeframeMonths: number
  jurisdictionCode: string
  lastFetchDate: Date | null
  lastFetchStatus: 'success' | 'error' | null
  lastFetchCount: number | null
}

const DEFAULT_CONFIG: ChurchConfig = {
  churchName: '',
  address: '118 NW Linden St, Ankeny, IA 50023',
  lat: null,
  lon: null,
  radiusMiles: 3,
  timeframeMonths: 1,
  jurisdictionCode: 'AK',
  lastFetchDate: null,
  lastFetchStatus: null,
  lastFetchCount: null,
}

export function useConfig() {
  const [config, setConfig] = useState<ChurchConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'config', 'church'), (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setConfig({
          ...DEFAULT_CONFIG,
          ...data,
          lastFetchDate: data.lastFetchDate?.toDate() ?? null,
        })
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  return { config, loading }
}
