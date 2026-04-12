import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

function getSnapshot() {
  return sessionStorage.getItem('authenticated') === 'true'
}

export function useAuth() {
  const authenticated = useSyncExternalStore(subscribe, getSnapshot)
  return { authenticated }
}

export function logout() {
  sessionStorage.removeItem('authenticated')
  window.dispatchEvent(new Event('storage'))
}
