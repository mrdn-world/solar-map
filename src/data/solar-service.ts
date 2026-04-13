// Tiled LOD solar data system
// LOD0: global 5° grid (zoom 0-3) — loads instantly
// LOD1: 30x30° tiles, 2° grid (zoom 3-6) — loads on demand
// LOD2: 10x10° tiles, 0.5° grid (zoom 6+) — loads on demand

export interface SolarGridV2 {
  step: number
  year?: string
  source?: string
  months?: string[]
  stats?: {
    ghi_min: number
    ghi_max: number
    ghi_avg: number
    count: number
    total: number
  }
  grid: SolarPoint[]
}

export type SolarPoint =
  | [number, number, number[], number, number[], number]
  | [number, number, null]

export type MonthIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 'annual'
export type DataMode = 'ghi' | 'pv' | 'temp-penalty'

// PV parameters
const PV_EFFICIENCY = 0.20
const TEMP_COEFF = -0.004  // power loss per °C above STC
const SYSTEM_LOSSES = 0.86
const STC_TEMP = 25
// Cell temperature model based on NOCT (Nominal Operating Cell Temperature ≈ 45°C)
// T_cell = T_ambient + (NOCT - 20) × G/800
// For daily averages: offset scales with GHI — panels barely heat up in low-sun regions
// Reference: +20°C offset at GHI = 5 kWh/m²/day (typical mid-latitude clear day)
const CELL_OFFSET_REF = 20    // °C offset at reference irradiance
const GHI_REF = 5             // kWh/m²/day reference

/** Effective cell temperature from ambient T2M and GHI */
export function cellTemp(ambientT2M: number, ghiKwhM2Day: number = GHI_REF): number {
  const offset = CELL_OFFSET_REF * (ghiKwhM2Day / GHI_REF)
  return ambientT2M + Math.min(offset, 35) // cap at 35°C offset
}

/** Temperature penalty as fraction (0 = no loss, 0.12 = 12% loss) */
export function tempPenaltyFraction(ambientT2M: number, ghiKwhM2Day: number = GHI_REF): number {
  const tCell = cellTemp(ambientT2M, ghiKwhM2Day)
  return tCell > STC_TEMP ? -TEMP_COEFF * (tCell - STC_TEMP) : 0
}

export function calcPVOutput(ghiKwhM2Day: number, tempC: number): number {
  const tCell = cellTemp(tempC, ghiKwhM2Day)
  const tempDerate = 1 + TEMP_COEFF * Math.max(0, tCell - STC_TEMP)
  return ghiKwhM2Day * PV_EFFICIENCY * tempDerate * SYSTEM_LOSSES
}

// ── LOD Manager ──

interface Manifest {
  year: string
  source: string
  months: string[]
  stats: SolarGridV2['stats']
  lods: {
    level: number
    step: number
    file?: string
    dir?: string
    tileSize?: number
    minZoom: number
    maxZoom: number
  }[]
}

interface LODState {
  manifest: Manifest | null
  lod0: SolarGridV2 | null
  tileCache: Map<string, SolarGridV2>
  loading: Set<string>
}

const state: LODState = {
  manifest: null,
  lod0: null,
  tileCache: new Map(),
  loading: new Set(),
}

export async function loadSolarData(): Promise<SolarGridV2 | null> {
  // Load manifest + LOD0
  if (!state.manifest) {
    try {
      const resp = await fetch('/solar/manifest.json')
      if (!resp.ok) return fallbackLoad()
      state.manifest = await resp.json()
    } catch {
      return fallbackLoad()
    }
  }

  if (!state.lod0) {
    try {
      const resp = await fetch('/solar/lod0.json')
      if (!resp.ok) return null
      state.lod0 = await resp.json()
    } catch {
      return null
    }
  }

  return state.lod0
}

// Fallback: try loading old single-file format
async function fallbackLoad(): Promise<SolarGridV2 | null> {
  try {
    const resp = await fetch('/solar-data.json')
    if (!resp.ok) return null
    const raw = await resp.json()
    if (raw.months) {
      state.lod0 = raw
      return raw
    }
    // v1 conversion
    const grid: SolarPoint[] = raw.grid.map(([lat, lon, hours]: [number, number, number | null]) => {
      if (hours === null) return [lat, lon, null] as [number, number, null]
      const ghi = hours / 365 / 0.75
      return [lat, lon, Array(12).fill(ghi), ghi, Array(12).fill(20), 20] as SolarPoint
    })
    const data: SolarGridV2 = {
      step: raw.step,
      year: '2001-2020',
      source: raw.source || 'NASA POWER',
      months: ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],
      stats: {
        ghi_min: raw.stats.min / 365 / 0.75,
        ghi_max: raw.stats.max / 365 / 0.75,
        ghi_avg: raw.stats.avg / 365 / 0.75,
        count: raw.grid.filter((g: any) => g[2] !== null).length,
        total: raw.grid.length,
      },
      grid,
    }
    state.lod0 = data
    return data
  } catch {
    return null
  }
}

// Get the best available data for a viewport
export function getLodLevel(zoom: number): number {
  if (!state.manifest) return 0
  for (const lod of state.manifest.lods) {
    if (zoom >= lod.minZoom && zoom < lod.maxZoom) return lod.level
  }
  return 2
}

function tileKey(level: number, lat: number, lon: number): string {
  return `lod${level}/${lat}_${lon}`
}

// Load tiles for visible bounds at the right LOD level
export async function loadTilesForView(
  zoom: number,
  bounds: { west: number; east: number; north: number; south: number },
  onUpdate: () => void,
): Promise<void> {
  if (!state.manifest) return

  const level = getLodLevel(zoom)
  if (level === 0) return // LOD0 already loaded globally

  const lodDef = state.manifest.lods.find(l => l.level === level)
  if (!lodDef || !lodDef.dir || !lodDef.tileSize) return

  const tileSize = lodDef.tileSize
  const latMin = Math.floor(bounds.south / tileSize) * tileSize
  const latMax = Math.floor(bounds.north / tileSize) * tileSize
  const lonMin = Math.floor(bounds.west / tileSize) * tileSize
  const lonMax = Math.floor(bounds.east / tileSize) * tileSize

  const promises: Promise<void>[] = []

  for (let lat = latMin; lat <= latMax; lat += tileSize) {
    for (let lon = lonMin; lon <= lonMax; lon += tileSize) {
      const key = tileKey(level, lat, lon)
      if (state.tileCache.has(key) || state.loading.has(key)) continue

      state.loading.add(key)
      const p = fetch(`/solar/${lodDef.dir}/${lat}_${lon}.json`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) state.tileCache.set(key, data)
          state.loading.delete(key)
        })
        .catch(() => { state.loading.delete(key) })

      promises.push(p)
    }
  }

  if (promises.length > 0) {
    await Promise.all(promises)
    onUpdate()
  }
}

// Always returns LOD0 for full-world raster.
// Higher LODs are used only for Dashboard point lookups.
export function getGridForView(
  _zoom: number,
  _bounds: { west: number; east: number; north: number; south: number },
): SolarGridV2 | null {
  return state.lod0
}

// Find nearest high-res point for a specific location (for Dashboard)
export function getPointData(
  lat: number,
  lon: number,
): { ghi: number[]; ghiAnn: number; temp: number[]; tempAnn: number } | null {
  if (!state.lod0) return null

  // Search in highest available LOD tiles first
  for (const level of [2, 1]) {
    const lodDef = state.manifest?.lods.find(l => l.level === level)
    if (!lodDef?.tileSize) continue
    const tLat = Math.floor(lat / lodDef.tileSize) * lodDef.tileSize
    const tLon = Math.floor(lon / lodDef.tileSize) * lodDef.tileSize
    const key = tileKey(level, tLat, tLon)
    const tile = state.tileCache.get(key)
    if (!tile) continue

    let bestDist = Infinity
    let best: SolarPoint | null = null
    for (const pt of tile.grid) {
      if (pt[2] === null) continue
      const d = (pt[0] - lat) ** 2 + (pt[1] - lon) ** 2
      if (d < bestDist) { bestDist = d; best = pt }
    }
    if (best && best[2] !== null) {
      return {
        ghi: best[2] as number[],
        ghiAnn: best[3] as number,
        temp: best[4] as number[],
        tempAnn: best[5] as number,
      }
    }
  }

  // Fallback to LOD0
  let bestDist = Infinity
  let best: SolarPoint | null = null
  for (const pt of state.lod0.grid) {
    if (pt[2] === null) continue
    const d = (pt[0] - lat) ** 2 + (pt[1] - lon) ** 2
    if (d < bestDist) { bestDist = d; best = pt }
  }
  if (best && best[2] !== null) {
    return {
      ghi: best[2] as number[],
      ghiAnn: best[3] as number,
      temp: best[4] as number[],
      tempAnn: best[5] as number,
    }
  }
  return null
}

// ── Raster generation (optimized) ──

// Pre-bake color LUT (256 entries) for instant color lookups
function buildColorLUT(mode: DataMode, _ghiMin: number, _ghiMax: number): Uint8Array {
  const lut = new Uint8Array(256 * 4)
  const stops = mode === 'pv' ? pvStops : mode === 'temp-penalty' ? tempPenaltyStops : ghiStops
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    const [r, g, b] = interpolateStops(stops, t)
    lut[i * 4] = r
    lut[i * 4 + 1] = g
    lut[i * 4 + 2] = b
    lut[i * 4 + 3] = 185
  }
  return lut
}

const ghiStops: [number, number, number, number][] = [
  [0.0,   12,  22,  72],
  [0.12,  22,  48, 128],
  [0.25,  38, 100, 165],
  [0.38,  50, 148, 135],
  [0.50,  85, 185,  78],
  [0.60, 165, 205,  48],
  [0.70, 222, 198,  28],
  [0.80, 248, 158,  10],
  [0.90, 242, 95,    5],
  [1.0,  205,  32,   5],
]

const pvStops: [number, number, number, number][] = [
  [0.0,  20,  15,  55],
  [0.15, 30,  60, 130],
  [0.3,  40, 120, 160],
  [0.5, 100, 190,  80],
  [0.7, 200, 200,  35],
  [0.85,250, 150,  10],
  [1.0, 235,  60,   5],
]

// Temperature penalty: 0% (cool/good) → 10%+ (hot/bad)
const tempPenaltyStops: [number, number, number, number][] = [
  [0.0,   30,  80, 160],  // blue — no loss
  [0.15,  50, 140, 140],  // teal
  [0.3,   80, 180,  90],  // green — mild
  [0.5,  180, 200,  50],  // yellow
  [0.7,  240, 160,  20],  // orange
  [0.85, 245, 100,  15],  // dark orange
  [1.0,  220,  40,  15],  // red — severe
]

function interpolateStops(stops: [number, number, number, number][], t: number): [number, number, number] {
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) {
      const s = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])
      return [
        Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * s),
        Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * s),
        Math.round(stops[i][3] + (stops[i + 1][3] - stops[i][3]) * s),
      ]
    }
  }
  const last = stops[stops.length - 1]
  return [last[1], last[2], last[3]]
}

// Spatial index: flat Float32Array grid for O(1) lookups
interface SpatialIndex {
  nLat: number
  nLon: number
  latMin: number
  lonMin: number
  latStep: number
  lonStep: number
  // For each grid cell: 12 monthly GHI + annual GHI + 12 monthly temp + annual temp = 26 floats
  // NaN = no data
  values: Float32Array
}

const VALS_PER_POINT = 26

function buildSpatialIndex(grid: SolarPoint[]): SpatialIndex | null {
  const validPts = grid.filter(g => g[2] !== null)
  if (validPts.length < 4) return null

  const latSet = new Set(validPts.map(g => g[0]))
  const lonSet = new Set(validPts.map(g => g[1]))
  const lats = [...latSet].sort((a, b) => a - b)
  const lons = [...lonSet].sort((a, b) => a - b)
  const nLat = lats.length
  const nLon = lons.length
  if (nLat < 2 || nLon < 2) return null

  const latStep = lats[1] - lats[0]
  const lonStep = lons[1] - lons[0]
  const latMin = lats[0]
  const lonMin = lons[0]

  const values = new Float32Array(nLat * nLon * VALS_PER_POINT).fill(NaN)

  for (const pt of validPts) {
    const li = Math.round((pt[0] - latMin) / latStep)
    const lj = Math.round((pt[1] - lonMin) / lonStep)
    if (li < 0 || li >= nLat || lj < 0 || lj >= nLon) continue
    const base = (li * nLon + lj) * VALS_PER_POINT
    const ghiArr = pt[2] as number[]
    const tempArr = pt[4] as number[]
    for (let m = 0; m < 12; m++) values[base + m] = ghiArr[m]
    values[base + 12] = pt[3] as number
    for (let m = 0; m < 12; m++) values[base + 13 + m] = tempArr[m]
    values[base + 25] = pt[5] as number
  }

  return { nLat, nLon, latMin, lonMin, latStep, lonStep, values }
}

function sampleValue(
  idx: SpatialIndex,
  month: MonthIndex,
  mode: DataMode,
  li: number,
  lj: number,
): number {
  if (li < 0 || li >= idx.nLat || lj < 0 || lj >= idx.nLon) return NaN
  const base = (li * idx.nLon + lj) * VALS_PER_POINT
  const ghiOffset = month === 'annual' ? 12 : month as number
  const ghi = idx.values[base + ghiOffset]
  if (isNaN(ghi)) return NaN
  if (mode === 'ghi') return ghi
  const tempOffset = month === 'annual' ? 25 : 13 + (month as number)
  const temp = idx.values[base + tempOffset]
  if (mode === 'temp-penalty') {
    // Return penalty percentage based on cell temperature (GHI-scaled NOCT offset)
    const t = isNaN(temp) ? 20 : temp
    return tempPenaltyFraction(t, ghi) * 100
  }
  return calcPVOutput(ghi, isNaN(temp) ? 20 : temp)
}

// Cached spatial index per data object (keyed by grid length as cheap identity)
let cachedIdx: SpatialIndex | null = null
let cachedIdxKey = ''

export function generateRaster(
  data: SolarGridV2,
  _width: number,  // ignored, we size to grid
  _height: number,
  month: MonthIndex,
  mode: DataMode,
): HTMLCanvasElement {
  // Build/reuse spatial index
  const idxKey = `${data.grid.length}_${data.step}`
  if (cachedIdxKey !== idxKey) {
    cachedIdx = buildSpatialIndex(data.grid)
    cachedIdxKey = idxKey
  }
  const idx = cachedIdx

  // Canvas sized to actual grid — MapLibre upscales smoothly
  const width = idx ? idx.nLon : 72
  const height = idx ? idx.nLat : 33
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  if (!idx) return canvas

  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(width, height)
  const pixels = imageData.data

  const ghiMin = data.stats?.ghi_min ?? 0
  const ghiMax = data.stats?.ghi_max ?? 8
  const valRange = mode === 'pv' ? 1.2 : mode === 'temp-penalty' ? 15 : (ghiMax - ghiMin)
  const valMin = mode === 'pv' ? 0 : mode === 'temp-penalty' ? 0 : ghiMin

  const colorLUT = buildColorLUT(mode, ghiMin, ghiMax)

  // 1:1 pixel-to-grid-cell — no interpolation needed, just direct lookup
  // py=0 is top (north), but spatial index row 0 is south — flip vertically
  for (let py = 0; py < height; py++) {
    const row = height - 1 - py
    for (let px = 0; px < width; px++) {
      const val = sampleValue(idx, month, mode, row, px)
      if (isNaN(val)) {
        pixels[(py * width + px) * 4 + 3] = 0
        continue
      }
      const t = Math.max(0, Math.min(255, ((val - valMin) / valRange * 255) | 0))
      const off = (py * width + px) * 4
      const ci = t * 4
      pixels[off] = colorLUT[ci]
      pixels[off + 1] = colorLUT[ci + 1]
      pixels[off + 2] = colorLUT[ci + 2]
      pixels[off + 3] = colorLUT[ci + 3]
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

// Generate a blended raster between two months (t=0 → monthA, t=1 → monthB)
export function generateBlendedRaster(
  data: SolarGridV2,
  monthA: MonthIndex,
  monthB: MonthIndex,
  t: number,
  mode: DataMode,
): HTMLCanvasElement {
  const idxKey = `${data.grid.length}_${data.step}`
  if (cachedIdxKey !== idxKey) {
    cachedIdx = buildSpatialIndex(data.grid)
    cachedIdxKey = idxKey
  }
  const idx = cachedIdx

  const width = idx ? idx.nLon : 72
  const height = idx ? idx.nLat : 33
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  if (!idx) return canvas

  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(width, height)
  const pixels = imageData.data

  const ghiMin = data.stats?.ghi_min ?? 0
  const ghiMax = data.stats?.ghi_max ?? 8
  const valRange = mode === 'pv' ? 1.2 : mode === 'temp-penalty' ? 15 : (ghiMax - ghiMin)
  const valMin = mode === 'pv' ? 0 : mode === 'temp-penalty' ? 0 : ghiMin
  const colorLUT = buildColorLUT(mode, ghiMin, ghiMax)

  for (let py = 0; py < height; py++) {
    const row = height - 1 - py
    for (let px = 0; px < width; px++) {
      const vA = sampleValue(idx, monthA, mode, row, px)
      const vB = sampleValue(idx, monthB, mode, row, px)
      const bothNaN = isNaN(vA) && isNaN(vB)
      if (bothNaN) {
        pixels[(py * width + px) * 4 + 3] = 0
        continue
      }
      const a = isNaN(vA) ? vB : vA
      const b = isNaN(vB) ? vA : vB
      const val = a + (b - a) * t

      const ti = Math.max(0, Math.min(255, ((val - valMin) / valRange * 255) | 0))
      const off = (py * width + px) * 4
      const ci = ti * 4
      pixels[off] = colorLUT[ci]
      pixels[off + 1] = colorLUT[ci + 1]
      pixels[off + 2] = colorLUT[ci + 2]
      pixels[off + 3] = colorLUT[ci + 3]
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

// Pre-generate all month rasters in background, call onReady with dataURL for each
export function pregenerateRasters(
  data: SolarGridV2,
  width: number,
  height: number,
  mode: DataMode,
  onReady: (month: MonthIndex, dataUrl: string) => void,
) {
  const months: MonthIndex[] = ['annual', 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  let i = 0
  function next() {
    if (i >= months.length) return
    const m = months[i++]
    const canvas = generateRaster(data, width, height, m, mode)
    onReady(m, canvas.toDataURL('image/png'))
    requestAnimationFrame(next)
  }
  requestAnimationFrame(next)
}
