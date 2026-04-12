import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export interface EmailConfig {
  recipientEmail: string
  schedule: 'weekly' | 'monthly' | 'quarterly' | 'biannual'
  timeframeMonths: number
  radiusMiles: number
  enabled: boolean
}

const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  recipientEmail: '',
  schedule: 'weekly',
  timeframeMonths: 1,
  radiusMiles: 3,
  enabled: false,
}

export function useEmailConfig() {
  const [emailConfig, setEmailConfig] =
    useState<EmailConfig>(DEFAULT_EMAIL_CONFIG)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'config', 'email'), (snap) => {
      if (snap.exists()) {
        setEmailConfig({ ...DEFAULT_EMAIL_CONFIG, ...snap.data() } as EmailConfig)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  return { emailConfig, loading }
}
