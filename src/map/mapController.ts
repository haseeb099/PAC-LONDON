import maplibregl, { type Map, type MapLayerMouseEvent, type StyleSpecification } from 'maplibre-gl'
import { LOCKED_BOROUGH_NAME, type BoroughFeatureCollection } from '../data/londonBoroughs'
import type { GeoPoint, ScreenPoint, Viewport } from '../types'

const TILE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
} as const

const BOROUGH_SOURCE = 'london-boroughs'
const BOROUGH_FILL = 'london-boroughs-fill'
const BOROUGH_LINE = 'london-boroughs-line'
const BOROUGH_LABEL = 'london-boroughs-label'
const GREATER_LONDON_BOUNDS: [[number, number], [number, number]] = [
  [-0.52, 51.28],
  [0.34, 51.70],
]

export class MapController {
  private readonly map: Map
  private boroughClickHandler: ((name: string) => void) | null = null

  public constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: TILE_STYLE,
      center: [-0.1, 51.5],
      zoom: 9.4,
      attributionControl: false,
    })

    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  }

  public resize(): void {
    this.map.resize()
  }

  public async ready(): Promise<void> {
    if (this.map.loaded()) {
      return
    }
    await new Promise<void>((resolve) => {
      this.map.once('load', () => resolve())
      if (this.map.loaded()) {
        resolve()
      }
    })
  }

  public getViewport(): Viewport {
    const bounds = this.map.getBounds()
    const center = this.map.getCenter()
    return {
      center: {
        lng: center.lng,
        lat: center.lat,
      },
      zoom: this.map.getZoom(),
      bounds: {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      },
    }
  }

  public flyTo(lng: number, lat: number): void {
    this.map.flyTo({
      center: [lng, lat],
      zoom: 16.8,
      speed: 0.8,
    })
  }

  public fitToPoints(points: GeoPoint[]): void {
    if (points.length === 0) {
      return
    }

    let west = Number.POSITIVE_INFINITY
    let east = Number.NEGATIVE_INFINITY
    let south = Number.POSITIVE_INFINITY
    let north = Number.NEGATIVE_INFINITY

    for (const point of points) {
      west = Math.min(west, point.lng)
      east = Math.max(east, point.lng)
      south = Math.min(south, point.lat)
      north = Math.max(north, point.lat)
    }

    // Pad tiny bounding boxes so MapLibre still has room to frame a readable maze.
    const lngPad = Math.max((east - west) * 0.08, 0.00018)
    const latPad = Math.max((north - south) * 0.08, 0.00012)

    this.map.fitBounds(
      [
        [west - lngPad, south - latPad],
        [east + lngPad, north + latPad],
      ],
      {
        padding: { top: 28, bottom: 48, left: 24, right: 24 },
        maxZoom: 17.6,
        duration: 380,
        essential: true,
      },
    )
  }

  public getZoom(): number {
    return this.map.getZoom()
  }

  public project(point: GeoPoint): ScreenPoint {
    const projected = this.map.project([point.lng, point.lat])
    return {
      x: projected.x,
      y: projected.y,
    }
  }

  public onViewChange(listener: () => void): void {
    this.map.on('move', listener)
    this.map.on('zoom', listener)
    this.map.on('resize', listener)
  }

  public setInteractive(enabled: boolean): void {
    const methods = [
      this.map.boxZoom,
      this.map.dragPan,
      this.map.dragRotate,
      this.map.doubleClickZoom,
      this.map.keyboard,
      this.map.scrollZoom,
      this.map.touchPitch,
      this.map.touchZoomRotate,
    ]
    for (const method of methods) {
      if (enabled) {
        method.enable()
      } else {
        method.disable()
      }
    }
  }

  public fitBounds(bounds: [[number, number], [number, number]], options: { maxZoom?: number; duration?: number; padding?: number } = {}): void {
    this.map.fitBounds(bounds, {
      padding: options.padding ?? 40,
      maxZoom: options.maxZoom ?? 14,
      duration: options.duration ?? 900,
      essential: true,
    })
  }

  public async showBoroughIntro(
    collection: BoroughFeatureCollection,
    onSelect: (name: string) => void,
  ): Promise<void> {
    await this.ready()
    this.boroughClickHandler = onSelect

    if (this.map.getSource(BOROUGH_SOURCE)) {
      this.clearBoroughLayers()
    }

    this.fitBounds(GREATER_LONDON_BOUNDS, { maxZoom: 10.2, duration: 650, padding: 28 })

    this.map.addSource(BOROUGH_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    this.map.addLayer({
      id: BOROUGH_FILL,
      type: 'fill',
      source: BOROUGH_SOURCE,
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'name'], LOCKED_BOROUGH_NAME],
          '#fb8500',
          '#4a5568',
        ],
        'fill-opacity': [
          'case',
          ['==', ['get', 'name'], LOCKED_BOROUGH_NAME],
          0.48,
          0.2,
        ],
      },
    })

    this.map.addLayer({
      id: BOROUGH_LINE,
      type: 'line',
      source: BOROUGH_SOURCE,
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'name'], LOCKED_BOROUGH_NAME],
          '#ffd60a',
          'rgba(255,255,255,0.55)',
        ],
        'line-width': [
          'case',
          ['==', ['get', 'name'], LOCKED_BOROUGH_NAME],
          3.4,
          1.15,
        ],
      },
    })

    // Labels only for the unlocked borough so glyph loading stays light.
    this.map.addLayer({
      id: BOROUGH_LABEL,
      type: 'symbol',
      source: BOROUGH_SOURCE,
      filter: ['==', ['get', 'name'], LOCKED_BOROUGH_NAME],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 14,
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-max-width': 10,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#fff3b0',
        'text-halo-color': 'rgba(20,28,34,0.9)',
        'text-halo-width': 1.6,
      },
    })

    this.map.on('click', BOROUGH_FILL, this.handleBoroughClick)
    this.map.on('mouseenter', BOROUGH_FILL, this.handleBoroughMouseEnter)
    this.map.on('mouseleave', BOROUGH_FILL, this.handleBoroughMouseLeave)

    const source = this.map.getSource(BOROUGH_SOURCE) as maplibregl.GeoJSONSource
    const ordered = [...collection.features].sort((a, b) => {
      if (a.properties.name === LOCKED_BOROUGH_NAME) {
        return 1
      }
      if (b.properties.name === LOCKED_BOROUGH_NAME) {
        return -1
      }
      return a.properties.name.localeCompare(b.properties.name)
    })

    const revealed: BoroughFeatureCollection['features'] = []
    for (const feature of ordered) {
      revealed.push(feature)
      source.setData({ type: 'FeatureCollection', features: revealed.slice() })
      await new Promise<void>((resolve) => window.setTimeout(resolve, 45))
    }
  }

  public clearBoroughLayers(): void {
    this.map.off('click', BOROUGH_FILL, this.handleBoroughClick)
    this.map.off('mouseenter', BOROUGH_FILL, this.handleBoroughMouseEnter)
    this.map.off('mouseleave', BOROUGH_FILL, this.handleBoroughMouseLeave)
    if (this.map.getLayer(BOROUGH_LABEL)) {
      this.map.removeLayer(BOROUGH_LABEL)
    }
    if (this.map.getLayer(BOROUGH_LINE)) {
      this.map.removeLayer(BOROUGH_LINE)
    }
    if (this.map.getLayer(BOROUGH_FILL)) {
      this.map.removeLayer(BOROUGH_FILL)
    }
    if (this.map.getSource(BOROUGH_SOURCE)) {
      this.map.removeSource(BOROUGH_SOURCE)
    }
    this.map.getCanvas().style.cursor = ''
  }

  private readonly handleBoroughClick = (event: MapLayerMouseEvent): void => {
    const name = String(event.features?.[0]?.properties?.name ?? '')
    if (!name || !this.boroughClickHandler) {
      return
    }
    this.boroughClickHandler(name)
  }

  private readonly handleBoroughMouseEnter = (event: MapLayerMouseEvent): void => {
    const name = String(event.features?.[0]?.properties?.name ?? '')
    this.map.getCanvas().style.cursor = name === LOCKED_BOROUGH_NAME ? 'pointer' : 'not-allowed'
  }

  private readonly handleBoroughMouseLeave = (): void => {
    this.map.getCanvas().style.cursor = ''
  }
}
