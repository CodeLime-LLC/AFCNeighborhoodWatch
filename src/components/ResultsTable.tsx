import type { SaleRecord } from '../hooks/useSales'
import { formatCurrency, formatDate, formatDistance, titleCase } from '../utils/formatters'

interface ResultsTableProps {
  sales: SaleRecord[]
  loading: boolean
}

function exportToCsv(sales: SaleRecord[]) {
  const headers = ['Address', 'City', 'ZIP', 'Buyer', 'Sale Date', 'Price', 'Distance (mi)', 'Type']
  const rows = sales.map((s) => [
    s.address,
    s.city,
    s.zip,
    s.buyer,
    s.saleDate.toISOString().split('T')[0],
    s.price.toString(),
    s.distanceMiles?.toFixed(1) ?? '',
    s.residenceType,
  ])

  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `new-movers-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ResultsTable({ sales, loading }: ResultsTableProps) {
  if (loading) {
    return <p className="text-gray-500">Loading results...</p>
  }

  if (sales.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
        No new movers found for the current filters. Try increasing the radius or timeframe.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {sales.length} result{sales.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => exportToCsv(sales)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Address</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Buyer</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Sale Date</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Price</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Distance</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sales.map((sale) => (
              <tr key={sale.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  {titleCase(sale.address)}
                  <span className="text-gray-400 ml-1">{sale.zip}</span>
                </td>
                <td className="px-4 py-2">{titleCase(sale.buyer)}</td>
                <td className="px-4 py-2">{formatDate(sale.saleDate)}</td>
                <td className="px-4 py-2 text-right">{formatCurrency(sale.price)}</td>
                <td className="px-4 py-2 text-right">
                  {sale.distanceMiles != null ? formatDistance(sale.distanceMiles) : '—'}
                </td>
                <td className="px-4 py-2">{sale.residenceType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
