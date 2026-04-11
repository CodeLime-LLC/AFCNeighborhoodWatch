import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../firebase', () => ({
  auth: {},
  db: {},
  functions: {},
}))

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}))

// Mock MapView since Leaflet doesn't work in jsdom
vi.mock('../components/MapView', () => ({
  default: (props: { sales: unknown[]; radiusMiles: number }) => (
    <div data-testid="map-view">
      Map: {props.sales.length} pins, {props.radiusMiles} mi radius
    </div>
  ),
}))

const mockUseConfig = vi.fn()
const mockUseSales = vi.fn()

vi.mock('../hooks/useConfig', () => ({
  useConfig: () => mockUseConfig(),
}))

vi.mock('../hooks/useSales', () => ({
  useSales: () => mockUseSales(),
}))

import Dashboard from '../components/Dashboard'

const sampleSale = {
  id: '1',
  address: '321 NE 9TH ST',
  city: 'ANKENY',
  zip: '50021',
  buyer: 'TEST BUYER',
  seller: 'TEST SELLER',
  saleDate: new Date(2026, 2, 15),
  price: 285000,
  lat: 41.7386,
  lon: -93.5966,
  distanceMiles: 1.8,
  residenceType: 'Single Family',
  totalLivingArea: 928,
  yearBuilt: 1975,
  geocodeStatus: 'matched',
  sourceKey: '20473-496',
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue({
      config: {
        churchName: 'Test Church',
        address: '118 NW Linden St, Ankeny, IA 50023',
        lat: 41.7295,
        lon: -93.6058,
        radiusMiles: 3,
        timeframeMonths: 1,
        jurisdictionCode: 'AK',
        lastFetchDate: new Date(2026, 2, 1),
        lastFetchStatus: 'success',
        lastFetchCount: 15,
      },
      loading: false,
    })

    mockUseSales.mockReturnValue({
      sales: [sampleSale],
      loading: false,
    })
  })

  it('renders the map', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    expect(screen.getByTestId('map-view')).toBeInTheDocument()
  })

  it('shows the fetch button', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    expect(screen.getByText('Fetch New Data')).toBeInTheDocument()
  })

  it('shows radius and timeframe controls', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    expect(screen.getByText('Radius:')).toBeInTheDocument()
    expect(screen.getByText('Timeframe:')).toBeInTheDocument()
  })

  it('shows sales count and export button', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    expect(screen.getByText(/new mover found/)).toBeInTheDocument()
    expect(screen.getByText('Export CSV')).toBeInTheDocument()
  })

  it('renders the results table with name and address', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    expect(screen.getByText(/Test Buyer/)).toBeInTheDocument()
    expect(screen.getByText(/321 Ne 9th St/)).toBeInTheDocument()
  })

  it('shows setup warning when no coordinates', () => {
    mockUseConfig.mockReturnValue({
      config: {
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
      },
      loading: false,
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    expect(screen.getByText(/Settings/)).toBeInTheDocument()
  })

  it('shows loading state', () => {
    mockUseConfig.mockReturnValue({
      config: {},
      loading: true,
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })
})
