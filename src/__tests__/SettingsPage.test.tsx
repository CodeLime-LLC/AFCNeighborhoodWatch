import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../firebase', () => ({
  auth: {},
  db: {},
  functions: {},
}))

vi.mock('../hooks/useConfig', () => ({
  useConfig: () => ({
    config: {
      churchName: 'Ankeny First Church',
      address: '118 NW Linden St, Ankeny, IA 50023',
      lat: 41.7295,
      lon: -93.6058,
      radiusMiles: 3,
      timeframeMonths: 1,
      jurisdictionCode: 'AK',
      lastFetchDate: null,
      lastFetchStatus: null,
      lastFetchCount: null,
    },
    loading: false,
  }),
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
}))

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}))

import SettingsPage from '../components/SettingsPage'

describe('SettingsPage', () => {
  it('renders settings form', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Church Name')).toBeInTheDocument()
    expect(screen.getByText('Church Address')).toBeInTheDocument()
  })

  it('displays default church address', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    const addressInput = screen.getByDisplayValue(
      '118 NW Linden St, Ankeny, IA 50023'
    )
    expect(addressInput).toBeInTheDocument()
  })

  it('displays church name', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    expect(
      screen.getByDisplayValue('Ankeny First Church')
    ).toBeInTheDocument()
  })

  it('shows geocode button', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Geocode')).toBeInTheDocument()
  })

  it('shows save button', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Save Settings')).toBeInTheDocument()
  })

  it('shows radius slider', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    expect(screen.getByText(/Search Radius: 3 miles/)).toBeInTheDocument()
  })

  it('shows timeframe dropdown', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Timeframe')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Last 1 month')).toBeInTheDocument()
  })

  it('shows coordinates when available', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    expect(screen.getByText(/41.7295/)).toBeInTheDocument()
    expect(screen.getByText(/-93.6058/)).toBeInTheDocument()
  })
})
