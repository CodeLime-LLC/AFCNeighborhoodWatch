import { useState, useEffect } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

export interface SaleRecord {
  id: string
  address: string
  city: string
  zip: string
  buyer: string
  seller: string
  saleDate: Date
  price: number
  lat: number | null
  lon: number | null
  distanceMiles: number | null
  residenceType: string
  totalLivingArea: number | null
  yearBuilt: number | null
  geocodeStatus: 'matched' | 'no_match'
  sourceKey: string
}

export function useSales(timeframeMonths: number, radiusMiles: number) {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const cutoffDate = new Date()
    cutoffDate.setMonth(cutoffDate.getMonth() - timeframeMonths)

    const q = query(
      collection(db, 'sales'),
      where('saleDate', '>=', Timestamp.fromDate(cutoffDate)),
      orderBy('saleDate', 'desc')
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: SaleRecord[] = []
      snapshot.forEach((doc) => {
        const data = doc.data()
        const record: SaleRecord = {
          id: doc.id,
          address: data.address,
          city: data.city,
          zip: data.zip,
          buyer: data.buyer,
          seller: data.seller,
          saleDate: data.saleDate.toDate(),
          price: data.price,
          lat: data.lat ?? null,
          lon: data.lon ?? null,
          distanceMiles: data.distanceMiles ?? null,
          residenceType: data.residenceType ?? '',
          totalLivingArea: data.totalLivingArea ?? null,
          yearBuilt: data.yearBuilt ?? null,
          geocodeStatus: data.geocodeStatus ?? 'no_match',
          sourceKey: data.sourceKey,
        }
        if (
          record.distanceMiles !== null &&
          record.distanceMiles <= radiusMiles
        ) {
          records.push(record)
        }
      })
      setSales(records)
      setLoading(false)
    })

    return unsubscribe
  }, [timeframeMonths, radiusMiles])

  return { sales, loading }
}
