import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ResultsTable from '../components/ResultsTable'
import type { SaleRecord } from '../hooks/useSales'

function makeSale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: Math.random().toString(),
    address: '321 NE 9TH ST',
    city: 'ANKENY',
    zip: '50021',
    buyer: 'DENNIS ISAAC ALEXANDER',
    seller: 'ZUBRADT DAVID',
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
    ...overrides,
  }
}

describe('ResultsTable', () => {
  it('shows loading state', () => {
    render(<ResultsTable sales={[]} loading={true} />)
    expect(screen.getByText('Loading results...')).toBeInTheDocument()
  })

  it('shows empty state when no sales', () => {
    render(<ResultsTable sales={[]} loading={false} />)
    expect(
      screen.getByText(/No new movers found/)
    ).toBeInTheDocument()
  })

  it('renders sales data correctly', () => {
    const sales = [makeSale()]
    render(<ResultsTable sales={sales} loading={false} />)

    expect(screen.getByText(/321 Ne 9th St/)).toBeInTheDocument()
    expect(screen.getByText(/Dennis Isaac Alexander/)).toBeInTheDocument()
    expect(screen.getByText('$285,000')).toBeInTheDocument()
    expect(screen.getByText('1.8 mi')).toBeInTheDocument()
    expect(screen.getByText('Single Family')).toBeInTheDocument()
  })

  it('shows result count', () => {
    const sales = [makeSale(), makeSale({ id: '2', address: '456 TEST ST' })]
    render(<ResultsTable sales={sales} loading={false} />)
    expect(screen.getByText('2 results')).toBeInTheDocument()
  })

  it('shows singular "result" for one item', () => {
    render(<ResultsTable sales={[makeSale()]} loading={false} />)
    expect(screen.getByText('1 result')).toBeInTheDocument()
  })

  it('has an export CSV button', () => {
    render(<ResultsTable sales={[makeSale()]} loading={false} />)
    expect(screen.getByText('Export CSV')).toBeInTheDocument()
  })

  it('renders multiple rows', () => {
    const sales = [
      makeSale({ id: '1', buyer: 'BUYER ONE' }),
      makeSale({ id: '2', buyer: 'BUYER TWO' }),
      makeSale({ id: '3', buyer: 'BUYER THREE' }),
    ]
    render(<ResultsTable sales={sales} loading={false} />)
    expect(screen.getByText(/Buyer One/)).toBeInTheDocument()
    expect(screen.getByText(/Buyer Two/)).toBeInTheDocument()
    expect(screen.getByText(/Buyer Three/)).toBeInTheDocument()
  })

  it('shows dash for null distance', () => {
    const sales = [makeSale({ distanceMiles: null })]
    render(<ResultsTable sales={sales} loading={false} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
