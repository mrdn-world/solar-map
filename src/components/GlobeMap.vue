<template>
  <div ref="containerRef" class="globe-map">
    <div ref="mapRef" class="globe-map-canvas" />
    <Tooltip :location="hoveredLoc" :x="tooltipX" :y="tooltipY" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import Tooltip from './Tooltip.vue'
import { locations, categoryColors, type LocationData } from '../data/sunny-days'
import {
  loadSolarData, loadTilesForView, getGridForView, getLodLevel,
  generateRaster, generateBlendedRaster, pregenerateRasters, calcPVOutput, tempPenaltyFraction,
  type MonthIndex, type DataMode, type SolarGridV2,
} from '../data/solar-service'

const props = defineProps<{
  selected: LocationData | null
  hovered: LocationData | null
  month: MonthIndex
  mode: DataMode
}>()

const emit = defineEmits<{
  select: [loc: LocationData | null]
  hover: [loc: LocationData | null]
}>()

const containerRef = ref<HTMLElement>()
const mapRef = ref<HTMLElement>()
const tooltipX = ref(0)
const tooltipY = ref(0)
const hoveredLoc = ref<LocationData | null>(null)
const loading = ref(true)

let map: maplibregl.Map | null = null
let currentLod = 0
const rasterURLs = new Map<string, string>()
let pregenMode: DataMode | null = null
let tweenAnim: number | null = null
let prevMonth: MonthIndex = 'annual'
let solarDataRef: SolarGridV2 | null = null

// ── Mini chart markers ──
let activeMarkerIds = new Set<number>()
const markerPool = new Map<number, maplibregl.Marker>()
let chartUpdateTimer: ReturnType<typeof setTimeout> | null = null

// Track which city IDs were on screen last frame (not just active — ALL visible)
// so we know which cities are truly "newly revealed" from behind an edge
let prevOnScreenIds: Set<number> | null = null

// Cached city solar values per mode
let cityValuesCache: Map<number, { values: number[]; ratio: number }> | null = null
let cityValuesCacheMode: DataMode | null = null

// Pre-indexed location lookup
const locById = new Map<number, LocationData>()
for (const loc of locations) locById.set(loc.id, loc)

function ensureCityValues(data: SolarGridV2, mode: DataMode): Map<number, { values: number[]; ratio: number }> {
  if (cityValuesCache && cityValuesCacheMode === mode) return cityValuesCache
  const result = new Map<number, { values: number[]; ratio: number }>()
  for (const loc of locations) {
    let best: SolarGridV2['grid'][0] | null = null
    let bestDist = Infinity
    for (const pt of data.grid) {
      if (pt[2] === null) continue
      const d = (pt[0] - loc.lat) ** 2 + (pt[1] - loc.lon) ** 2
      if (d < bestDist) { bestDist = d; best = pt }
    }
    if (!best || best[2] === null) continue
    const ghi = best[2] as number[]
    const temp = best[4] as number[]
    const values = mode === 'temp-penalty'
      ? ghi.map((g, i) => tempPenaltyFraction(temp[i], g) * 100)
      : mode === 'pv' ? ghi.map((g, i) => calcPVOutput(g, temp[i])) : [...ghi]
    const max = Math.max(...values)
    const min = Math.min(...values)
    const ratio = min > 0 ? max / min : max > 0 ? 10 : 1
    result.set(loc.id, { values, ratio })
  }
  cityValuesCache = result
  cityValuesCacheMode = mode
  return result
}

// Pre-baked color LUT for bar colors (256 entries)
const BAR_COLOR_LUT: string[] = (() => {
  const stops: [number, number, number, number][] = [
    [0.0,  60, 100, 180],
    [0.25, 60, 170, 160],
    [0.5,  90, 200,  80],
    [0.75,210, 200,  40],
    [1.0, 245, 130,  20],
  ]
  const lut: string[] = []
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let r = 245, g = 130, b = 20
    for (let j = 0; j < stops.length - 1; j++) {
      if (t <= stops[j + 1][0]) {
        const s = (t - stops[j][0]) / (stops[j + 1][0] - stops[j][0])
        r = Math.round(stops[j][1] + (stops[j + 1][1] - stops[j][1]) * s)
        g = Math.round(stops[j][2] + (stops[j + 1][2] - stops[j][2]) * s)
        b = Math.round(stops[j][3] + (stops[j + 1][3] - stops[j][3]) * s)
        break
      }
    }
    lut.push(`rgb(${r},${g},${b})`)
  }
  return lut
})()

// Temp-penalty bar color LUT (256 entries, blue→red)
const PENALTY_COLOR_LUT: string[] = (() => {
  const stops: [number, number, number, number][] = [
    [0.0,   50, 120, 180],
    [0.3,  100, 180, 120],
    [0.5,  200, 200,  50],
    [0.7,  240, 150,  30],
    [1.0,  230,  50,  30],
  ]
  const lut: string[] = []
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let r = 230, g = 50, b = 30
    for (let j = 0; j < stops.length - 1; j++) {
      if (t <= stops[j + 1][0]) {
        const s = (t - stops[j][0]) / (stops[j + 1][0] - stops[j][0])
        r = Math.round(stops[j][1] + (stops[j + 1][1] - stops[j][1]) * s)
        g = Math.round(stops[j][2] + (stops[j + 1][2] - stops[j][2]) * s)
        b = Math.round(stops[j][3] + (stops[j + 1][3] - stops[j][3]) * s)
        break
      }
    }
    lut.push(`rgb(${r},${g},${b})`)
  }
  return lut
})()

// Cached canvas data URLs per city+mode
const chartCanvasCache = new Map<string, string>()

function renderChartDataURL(values: number[], mode: DataMode): string {
  const dpr = 2
  const cw = 36, ch = 30
  const canvas = document.createElement('canvas')
  canvas.width = cw * dpr
  canvas.height = ch * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  const globalMax = mode === 'pv' ? 1.2 : mode === 'temp-penalty' ? 15 : 8
  const colorLut = mode === 'temp-penalty' ? PENALTY_COLOR_LUT : BAR_COLOR_LUT
  const barW = cw / 12

  if (mode === 'temp-penalty') {
    // Draw inverted: bars grow downward from top (like sidebar penalty chart)
    // Top line (zero)
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.fillRect(0, 0, cw, 0.5)
    for (let i = 0; i < 12; i++) {
      const barH = Math.max(1, (values[i] / globalMax) * (ch - 2))
      const x = i * barW
      const ci = Math.max(0, Math.min(255, (values[i] / globalMax * 255) | 0))
      // Gradient from pink (low) to red (high), matching sidebar rgba(249,124,148)
      const t = ci / 255
      const r = Math.round(180 + t * 70)   // 180→250
      const g = Math.round(160 - t * 80)   // 160→80
      const b = Math.round(180 - t * 40)   // 180→140
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.globalAlpha = 0.8
      ctx.fillRect(x, 1, barW - 0.5, barH)
    }
  } else {
    for (let i = 0; i < 12; i++) {
      const barH = Math.max(1, (values[i] / globalMax) * (ch - 2))
      const x = i * barW
      const y = ch - barH
      const ci = Math.max(0, Math.min(255, (values[i] / globalMax * 255) | 0))
      ctx.fillStyle = colorLut[ci]
      ctx.globalAlpha = 0.85
      ctx.fillRect(x, y, barW - 0.5, barH)
    }
  }

  return canvas.toDataURL()
}

function getOrCreateMarker(loc: LocationData, values: number[], mode: DataMode): maplibregl.Marker {
  const existing = markerPool.get(loc.id)
  if (existing) return existing

  const container = document.createElement('div')
  container.className = 'mini-chart'

  const cacheKey = `${loc.id}_${mode}`
  let dataUrl = chartCanvasCache.get(cacheKey)
  if (!dataUrl) {
    dataUrl = renderChartDataURL(values, mode)
    chartCanvasCache.set(cacheKey, dataUrl)
  }

  const img = document.createElement('img')
  img.src = dataUrl
  img.width = 36
  img.height = 30
  img.style.display = 'block'
  container.appendChild(img)

  const label = document.createElement('div')
  label.className = 'mini-chart-label'
  label.textContent = loc.city
  container.appendChild(label)

  container.addEventListener('mouseenter', () => {
    hoveredLoc.value = loc
    emit('hover', loc)
    container.classList.add('hovered')
    // Update tooltip position to marker's screen location
    if (map) {
      const pt = map.project([loc.lon, loc.lat])
      tooltipX.value = pt.x
      tooltipY.value = pt.y
    }
  })
  container.addEventListener('mouseleave', () => {
    hoveredLoc.value = null
    emit('hover', null)
    container.classList.remove('hovered')
  })
  container.addEventListener('click', (e) => {
    e.stopPropagation()
    emit('select', loc)
  })

  const marker = new maplibregl.Marker({ element: container, anchor: 'bottom' })
    .setLngLat([loc.lon, loc.lat])

  markerPool.set(loc.id, marker)
  return marker
}

// Minimum screen-space distance between any two chart markers (pixels)
const MIN_CHART_DIST = 55
const MIN_CHART_DIST_SQ = MIN_CHART_DIST * MIN_CHART_DIST

function updateMiniCharts() {
  if (!map || !solarDataRef) return
  const showCharts = props.month === 'annual'

  if (!showCharts) {
    for (const id of activeMarkerIds) markerPool.get(id)?.remove()
    activeMarkerIds.clear()
    prevOnScreenIds = null
    return
  }

  const cityValues = ensureCityValues(solarDataRef, props.mode)
  const mapCanvas = map.getCanvas()
  const screenW = mapCanvas.clientWidth
  const screenH = mapCanvas.clientHeight
  const mx = 60, my = 60, bottomMargin = 110

  // ── Step 0: project all cities once ──
  interface CityScreen { id: number; sx: number; sy: number; ratio: number }
  const onScreen: CityScreen[] = []
  const curOnScreenIds = new Set<number>()

  for (const loc of locations) {
    const cv = cityValues.get(loc.id)
    if (!cv) continue
    const pt = map.project([loc.lon, loc.lat])
    if (pt.x < mx || pt.x > screenW - mx || pt.y < my || pt.y > screenH - bottomMargin) continue
    onScreen.push({ id: loc.id, sx: pt.x, sy: pt.y, ratio: cv.ratio })
    curOnScreenIds.add(loc.id)
  }

  const isFirstLoad = prevOnScreenIds === null

  // ── Step 1: keep survivors (active + still on screen) ──
  // Stored as array of screen positions for fast overlap checks
  const survivorScreens: CityScreen[] = []
  const survivorIds = new Set<number>()

  for (const id of activeMarkerIds) {
    const cs = onScreen.find(c => c.id === id)
    if (cs) {
      survivorScreens.push(cs)
      survivorIds.add(id)
    } else {
      // Off-screen → remove
      markerPool.get(id)?.remove()
    }
  }

  // ── Step 2: collision pruning among survivors ──
  // On zoom-out, survivors may start overlapping — remove the weaker one
  const pruned = new Set<number>()
  for (let i = 0; i < survivorScreens.length; i++) {
    if (pruned.has(survivorScreens[i].id)) continue
    for (let j = i + 1; j < survivorScreens.length; j++) {
      if (pruned.has(survivorScreens[j].id)) continue
      const dx = survivorScreens[i].sx - survivorScreens[j].sx
      const dy = survivorScreens[i].sy - survivorScreens[j].sy
      if (dx * dx + dy * dy < MIN_CHART_DIST_SQ) {
        const victim = survivorScreens[i].ratio < survivorScreens[j].ratio
          ? survivorScreens[i].id : survivorScreens[j].id
        pruned.add(victim)
      }
    }
  }
  for (const id of pruned) {
    markerPool.get(id)?.remove()
    survivorIds.delete(id)
  }

  // Rebuild clean survivor positions list
  const kept: CityScreen[] = survivorScreens.filter(s => survivorIds.has(s.id))
  const freedSlots = activeMarkerIds.size - survivorIds.size

  // ── Step 3: find candidates ──
  // Prefer newly-revealed cities (from edges), then backfill from all on-screen
  const isMobile = window.innerWidth <= 768
  const TARGET_COUNT = isMobile ? 15 : 30
  const candidates: CityScreen[] = []
  const backfill: CityScreen[] = []
  for (const cs of onScreen) {
    if (survivorIds.has(cs.id)) continue
    if (!isFirstLoad && prevOnScreenIds!.has(cs.id)) {
      backfill.push(cs) // was already visible but not active
    } else {
      candidates.push(cs) // newly revealed
    }
  }

  // Shuffle both pools
  function shuffle(arr: CityScreen[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
  }
  shuffle(candidates)
  shuffle(backfill)

  // ── Step 4: greedily add candidates that don't overlap ──
  // First fill from newly-revealed, then backfill to reach TARGET_COUNT
  const slotsAvailable = isFirstLoad ? TARGET_COUNT : Math.max(freedSlots, TARGET_COUNT - survivorIds.size)
  const allCandidates = candidates.concat(backfill)
  let added = 0

  for (const cand of allCandidates) {
    if (added >= slotsAvailable) break

    // Check min distance against all kept markers
    let tooClose = false
    for (const k of kept) {
      const dx = cand.sx - k.sx
      const dy = cand.sy - k.sy
      if (dx * dx + dy * dy < MIN_CHART_DIST_SQ) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    const loc = locById.get(cand.id)!
    const cv = cityValues.get(cand.id)!
    const marker = getOrCreateMarker(loc, cv.values, props.mode)
    if (!activeMarkerIds.has(cand.id)) marker.addTo(map!)
    survivorIds.add(cand.id)
    kept.push(cand)
    added++
  }

  // ── Step 5: finalize ──
  for (const id of activeMarkerIds) {
    if (!survivorIds.has(id)) markerPool.get(id)?.remove()
  }
  activeMarkerIds = survivorIds
  prevOnScreenIds = curOnScreenIds
}

// Hide city dots/glow for cities that have a visible mini chart
function syncDotVisibility() {
  if (!map || !map.getLayer('cities-dots')) return
  if (activeMarkerIds.size === 0) {
    map.setFilter('cities-dots', null)
    map.setFilter('cities-glow', null)
    if (map.getLayer('cities-labels')) map.setFilter('cities-labels', null)
    if (map.getLayer('cities-values')) map.setFilter('cities-values', null)
  } else {
    const ids = [...activeMarkerIds]
    const filter: any = ['!', ['in', ['get', 'id'], ['literal', ids]]]
    map.setFilter('cities-dots', filter)
    map.setFilter('cities-glow', filter)
    if (map.getLayer('cities-labels')) map.setFilter('cities-labels', filter)
    if (map.getLayer('cities-values')) map.setFilter('cities-values', filter)
  }
}

function debouncedUpdateCharts() {
  if (chartUpdateTimer) clearTimeout(chartUpdateTimer)
  // Skip during tween animation — causes jank
  if (tweenAnim) return
  chartUpdateTimer = setTimeout(() => {
    updateMiniCharts()
    syncDotVisibility()
  }, 150)
}

// ── Map helpers ──

function citiesGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: locations.map(loc => ({
      type: 'Feature' as const,
      id: loc.id,
      geometry: { type: 'Point' as const, coordinates: [loc.lon, loc.lat] },
      properties: {
        id: loc.id,
        city: loc.city,
        cityRu: loc.cityRu,
        sunnyDays: loc.sunnyDays,
        category: loc.category,
        color: categoryColors[loc.category],
      },
    })),
  }
}

function getMapBounds(m: maplibregl.Map) {
  const b = m.getBounds()
  return { west: b.getWest(), east: b.getEast(), north: b.getNorth(), south: b.getSouth() }
}

const RASTER_COORDS: [[number,number],[number,number],[number,number],[number,number]] = [
  [-180, 85], [180, 85], [180, -85], [-180, -85],
]

function applyRasterURL(m: maplibregl.Map, dataUrl: string) {
  const source = m.getSource('solar-raster') as maplibregl.ImageSource | undefined
  if (source) {
    source.updateImage({ url: dataUrl })
  } else {
    m.addSource('solar-raster', {
      type: 'image',
      url: dataUrl,
      coordinates: RASTER_COORDS,
    })
    m.addLayer({
      id: 'solar-overlay',
      type: 'raster',
      source: 'solar-raster',
      paint: {
        'raster-opacity': [
          'interpolate', ['linear'], ['zoom'],
          0, 0.8, 6, 0.6, 10, 0.35, 14, 0.15,
        ],
        'raster-fade-duration': 0,
      },
    }, 'base-tiles')
    m.moveLayer('solar-overlay', 'base-tiles')
  }
}

function renderAndApply(m: maplibregl.Map, data: SolarGridV2, month: MonthIndex, mode: DataMode) {
  const cacheKey = `${month}_${mode}_${data.grid.length}`
  const cached = rasterURLs.get(cacheKey)
  if (cached) {
    applyRasterURL(m, cached)
    return
  }

  const canvas = generateRaster(data, 0, 0, month, mode)
  const dataUrl = canvas.toDataURL('image/png')
  rasterURLs.set(cacheKey, dataUrl)
  applyRasterURL(m, dataUrl)

  if (pregenMode !== mode) {
    pregenMode = mode
    pregenerateRasters(data, 0, 0, mode, (pm, url) => {
      rasterURLs.set(`${pm}_${mode}_${data.grid.length}`, url)
    })
  }
}

function tweenToMonth(m: maplibregl.Map, data: SolarGridV2, from: MonthIndex, to: MonthIndex, mode: DataMode) {
  if (tweenAnim) cancelAnimationFrame(tweenAnim)

  if (from === to) {
    renderAndApply(m, data, to, mode)
    return
  }

  const duration = 300
  const t0 = performance.now()

  function frame(now: number) {
    const t = Math.min(1, (now - t0) / duration)
    if (t >= 1) {
      renderAndApply(m, data, to, mode)
      tweenAnim = null
      return
    }
    const canvas = generateBlendedRaster(data, from, to, t, mode)
    applyRasterURL(m, canvas.toDataURL('image/png'))
    tweenAnim = requestAnimationFrame(frame)
  }
  tweenAnim = requestAnimationFrame(frame)
}

function refreshRaster() {
  if (!map) return
  const zoom = map.getZoom()
  const bounds = getMapBounds(map)
  const data = getGridForView(zoom, bounds)
  if (data) {
    rasterURLs.clear()
    renderAndApply(map, data, props.month, props.mode)
  }
}

let loadDebounce: ReturnType<typeof setTimeout> | null = null
function onViewChange() {
  if (!map) return
  if (loadDebounce) clearTimeout(loadDebounce)
  loadDebounce = setTimeout(() => {
    const zoom = map!.getZoom()
    const bounds = getMapBounds(map!)
    const newLod = getLodLevel(zoom)

    loadTilesForView(zoom, bounds, () => {
      refreshRaster()
    })

    if (newLod !== currentLod) {
      currentLod = newLod
      refreshRaster()
    }
  }, 200)
}

onMounted(async () => {
  if (!mapRef.value) return

  map = new maplibregl.Map({
    container: mapRef.value,
    preserveDrawingBuffer: true,
    style: {
      version: 8,
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sources: {
        'carto-dark': {
          type: 'raster',
          tiles: ['https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png'],
          tileSize: 256,
          attribution: '&copy; CARTO &copy; OSM',
          maxzoom: 19,
        },
        'carto-labels': {
          type: 'raster',
          tiles: ['https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png'],
          tileSize: 256,
          maxzoom: 19,
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#08090d' } },
        {
          id: 'base-tiles',
          type: 'raster',
          source: 'carto-dark',
          paint: {
            'raster-opacity': 0.55,
            'raster-brightness-max': 0.4,
            'raster-saturation': -0.5,
          },
        },
      ],
    },
    center: [30, 20],
    zoom: 2,
    minZoom: 1.5,
    maxZoom: 18,
    projection: { type: 'globe' },
    attributionControl: false,
  })

  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

  // Expose map instance for export
  ;(mapRef.value as any).__mapInstance = map

  map.on('load', async () => {
    if (!map) return

    try {
      const lod0 = await loadSolarData()
      if (lod0) {
        solarDataRef = lod0
        renderAndApply(map, lod0, props.month, props.mode)
        prevMonth = props.month
        updateMiniCharts()
        syncDotVisibility()
      }
    } catch (e) {
      console.warn('Failed to load solar data:', e)
    } finally {
      loading.value = false
    }

    // CARTO labels — fade out when our city labels appear
    map.addLayer({
      id: 'labels',
      type: 'raster',
      source: 'carto-labels',
      paint: {
        'raster-opacity': [
          'interpolate', ['linear'], ['zoom'],
          0, 0,
          3, 0.4,
          4.5, 0.5,
          5.5, 0.15,
          7, 0,
        ],
      },
    })

    // City markers
    map.addSource('cities', { type: 'geojson', data: citiesGeoJSON() })

    map.addLayer({
      id: 'cities-glow',
      type: 'circle',
      source: 'cities',
      minzoom: 2,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 8, 6, 15, 12, 25],
        'circle-color': ['get', 'color'],
        'circle-blur': 1,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.05, 4, 0.15, 8, 0.1],
      },
    })

    map.addLayer({
      id: 'cities-dots',
      type: 'circle',
      source: 'cities',
      minzoom: 2,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2, 6, 4, 12, 7],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.3, 4, 0.8, 8, 0.95],
        'circle-stroke-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 2,
          ['boolean', ['feature-state', 'selected'], false], 2,
          0.5,
        ],
        'circle-stroke-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], '#fff',
          ['boolean', ['feature-state', 'selected'], false], '#fff',
          'rgba(255,255,255,0.2)',
        ],
      },
    })

    map.addLayer({
      id: 'cities-labels',
      type: 'symbol',
      source: 'cities',
      minzoom: 5,
      layout: {
        'text-field': ['get', 'city'],
        'text-font': ['Open Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 14],
        'text-offset': [0, 1.3],
        'text-anchor': 'top',
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#d4d0c8',
        'text-halo-color': 'rgba(8,9,13,0.9)',
        'text-halo-width': 1.5,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 6, 1],
      },
    })

    map.addLayer({
      id: 'cities-values',
      type: 'symbol',
      source: 'cities',
      minzoom: 7,
      layout: {
        'text-field': ['concat', ['get', 'sunnyDays'], ' days/yr'],
        'text-font': ['Open Sans Regular'],
        'text-size': 11,
        'text-offset': [0, -1.2],
        'text-anchor': 'bottom',
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': 'rgba(8,9,13,0.9)',
        'text-halo-width': 1,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 8, 0.9],
      },
    })

    // Interactions
    let hoveredId: number | null = null

    map.on('mousemove', 'cities-dots', (e) => {
      if (!map || !e.features?.length) return
      map.getCanvas().style.cursor = 'pointer'
      const f = e.features[0]
      const loc = locations.find(l => l.id === f.properties!.id)

      if (hoveredId !== null && hoveredId !== f.id) {
        map.setFeatureState({ source: 'cities', id: hoveredId }, { hover: false })
      }
      if (loc) {
        hoveredId = loc.id
        hoveredLoc.value = loc
        emit('hover', loc)
        map.setFeatureState({ source: 'cities', id: loc.id }, { hover: true })
      }
      tooltipX.value = e.point.x
      tooltipY.value = e.point.y
    })

    map.on('mouseleave', 'cities-dots', () => {
      if (!map) return
      map.getCanvas().style.cursor = ''
      if (hoveredId !== null) {
        map.setFeatureState({ source: 'cities', id: hoveredId }, { hover: false })
        hoveredId = null
      }
      hoveredLoc.value = null
      emit('hover', null)
    })

    map.on('click', 'cities-dots', (e) => {
      if (!e.features?.length) return
      const loc = locations.find(l => l.id === e.features![0].properties!.id)
      emit('select', loc ?? null)
    })

    map.on('click', (e) => {
      if (!map) return
      const features = map.queryRenderedFeatures(e.point, { layers: ['cities-dots'] })
      if (!features.length) emit('select', null)
    })

    // Update mini charts on view change
    map.on('moveend', debouncedUpdateCharts)
    map.on('zoomend', debouncedUpdateCharts)
  })
})

watch(() => props.month, (month) => {
  if (!map) return
  const zoom = map.getZoom()
  const bounds = getMapBounds(map)
  const data = getGridForView(zoom, bounds)
  if (data) {
    tweenToMonth(map, data, prevMonth, month, props.mode)
    prevMonth = month
  }
  updateMiniCharts()
  syncDotVisibility()
})

watch(() => props.mode, () => {
  if (!map) return
  rasterURLs.clear()
  pregenMode = null
  cityValuesCache = null
  chartCanvasCache.clear()
  prevOnScreenIds = null
  for (const id of activeMarkerIds) markerPool.get(id)?.remove()
  activeMarkerIds.clear()
  markerPool.clear()
  const zoom = map.getZoom()
  const bounds = getMapBounds(map)
  const data = getGridForView(zoom, bounds)
  if (data) {
    renderAndApply(map, data, props.month, props.mode)
  }
  updateMiniCharts()
  syncDotVisibility()
})

watch(() => props.selected, (loc) => {
  if (!map || !loc) return
  locations.forEach(l => {
    map!.setFeatureState({ source: 'cities', id: l.id }, { selected: l.id === loc.id })
  })
  map.flyTo({
    center: [loc.lon, loc.lat],
    zoom: Math.max(map.getZoom(), 6),
    duration: 1500,
    essential: true,
  })
})

onUnmounted(() => {
  if (loadDebounce) clearTimeout(loadDebounce)
  if (tweenAnim) cancelAnimationFrame(tweenAnim)
  if (chartUpdateTimer) clearTimeout(chartUpdateTimer)
  for (const m of markerPool.values()) m.remove()
  markerPool.clear()
  activeMarkerIds.clear()
  map?.remove()
  map = null
})
</script>

<style lang="scss">
.globe-map {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.globe-map-canvas {
  width: 100%;
  height: 100%;
}

.globe-loading {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(8, 9, 13, 0.85);
  backdrop-filter: blur(8px);
}

.globe-loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--c-text-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.globe-loading-text {
  font-size: 13px;
  color: var(--c-text-dim);
}

// Mini chart markers
.mini-chart {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
  opacity: 0.8;

  &:hover, &.hovered {
    transform: scale(1.15);
    opacity: 1;
  }

  canvas {
    border-radius: 2px;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
  }
}

.mini-chart-label {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.7);
  white-space: nowrap;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  line-height: 1.1;
}

@media (max-width: 768px) {
  .mini-chart {
    transform: scale(0.75);
    transform-origin: center bottom;

    &:hover, &.hovered {
      transform: scale(0.85);
    }
  }

  .mini-chart-label {
    font-size: 8px;
    max-width: 56px;
  }
}

// MapLibre overrides
.maplibregl-ctrl-group {
  background: var(--c-surface) !important;
  border: 1px solid var(--c-border) !important;
  border-radius: 8px !important;

  button {
    background: transparent !important;
    border: none !important;
    width: 32px !important;
    height: 32px !important;
    &:hover { background: var(--c-surface-hover) !important; }
    .maplibregl-ctrl-icon { filter: invert(1) brightness(0.8); }
  }

  button + button {
    border-top: 1px solid var(--c-border) !important;
  }
}

.maplibregl-ctrl-bottom-right {
  right: 24px !important;
  bottom: 24px !important;

  .maplibregl-ctrl {
    margin: 0 0 8px 0 !important;
  }
}

.maplibregl-ctrl-attrib {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.2) !important;
  font-size: 10px !important;
  margin-right: 5px !important;
  a { color: rgba(255, 255, 255, 0.3) !important; }
}

@media (max-width: 768px) {
  .maplibregl-ctrl-bottom-right {
    bottom: 48px !important;
  }

  .maplibregl-ctrl-group button {
    width: 28px !important;
    height: 28px !important;
  }
}
</style>
