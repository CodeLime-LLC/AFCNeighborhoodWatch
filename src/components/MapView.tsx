import { useEffect } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { SaleRecord } from '../hooks/useSales'
import { formatDate, titleCase } from '../utils/formatters'

// Fix default marker icons in Leaflet + bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const churchIcon = new L.Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: 'church-marker',
})

const saleIcon = new L.DivIcon({
  html: `<div style="background:#3b82f6;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  className: '',
})

interface MapViewProps {
  churchLat: number
  churchLon: number
  churchName: string
  radiusMiles: number
  sales: SaleRecord[]
}

function FitBounds({
  churchLat,
  churchLon,
  radiusMiles,
}: {
  churchLat: number
  churchLon: number
  radiusMiles: number
}) {
  const map = useMap()

  useEffect(() => {
    const radiusMeters = radiusMiles * 1609.34
    const center = L.latLng(churchLat, churchLon)
    const bounds = center.toBounds(radiusMeters * 2.2)
    map.fitBounds(bounds, { padding: [20, 20] })
  }, [map, churchLat, churchLon, radiusMiles])

  return null
}

export default function MapView({
  churchLat,
  churchLon,
  churchName,
  radiusMiles,
  sales,
}: MapViewProps) {
  const radiusMeters = radiusMiles * 1609.34

  return (
    <MapContainer
      center={[churchLat, churchLon]}
      zoom={13}
      className="w-full rounded-lg shadow"
      style={{ height: '500px' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds
        churchLat={churchLat}
        churchLon={churchLon}
        radiusMiles={radiusMiles}
      />

      {/* Radius circle */}
      <Circle
        center={[churchLat, churchLon]}
        radius={radiusMeters}
        pathOptions={{
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
          weight: 2,
        }}
      />

      {/* Church marker */}
      <Marker position={[churchLat, churchLon]} icon={churchIcon}>
        <Popup>
          <strong>{churchName || 'Church'}</strong>
          <br />
          Center point
        </Popup>
      </Marker>

      {/* Sale markers */}
      {sales.map(
        (sale) =>
          sale.lat != null &&
          sale.lon != null && (
            <Marker key={sale.id} position={[sale.lat, sale.lon]} icon={saleIcon}>
              <Popup>
                <div className="text-xs">
                  <p className="font-bold">{titleCase(sale.buyer)}</p>
                  <p>{titleCase(sale.address)}</p>
                  <p>{formatDate(sale.saleDate)}</p>
                  <p className="text-gray-500">
                    {sale.distanceMiles?.toFixed(1)} mi from church
                  </p>
                </div>
              </Popup>
            </Marker>
          )
      )}
    </MapContainer>
  )
}
