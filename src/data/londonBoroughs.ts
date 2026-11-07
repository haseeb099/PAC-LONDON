export const LOCKED_BOROUGH_NAME = 'Tower Hamlets'

export interface BoroughFeatureProperties {
  name: string
}

export type BoroughFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, BoroughFeatureProperties>

let cachedBoroughs: BoroughFeatureCollection | null = null

export async function loadLondonBoroughs(): Promise<BoroughFeatureCollection> {
  if (cachedBoroughs) {
    return cachedBoroughs
  }

  const response = await fetch(`${import.meta.env.BASE_URL}london-boroughs.geojson`)
  if (!response.ok) {
    throw new Error('Failed to load London borough boundaries')
  }

  const payload = await response.json() as BoroughFeatureCollection
  cachedBoroughs = {
    type: 'FeatureCollection',
    features: payload.features.map((feature) => ({
      ...feature,
      properties: {
        name: String(feature.properties?.name ?? feature.id ?? 'Unknown'),
      },
    })),
  }
  return cachedBoroughs
}

export function getBoroughFeature(
  collection: BoroughFeatureCollection,
  name: string,
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, BoroughFeatureProperties> | null {
  return collection.features.find((feature) => feature.properties.name === name) ?? null
}

export function getFeatureBounds(
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): [[number, number], [number, number]] {
  let west = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY

  const visit = (ring: number[][]): void => {
    for (const point of ring) {
      const [lng, lat] = point
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }

  const geometry = feature.geometry
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      visit(ring)
    }
  } else {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        visit(ring)
      }
    }
  }

  return [
    [west, south],
    [east, north],
  ]
}
