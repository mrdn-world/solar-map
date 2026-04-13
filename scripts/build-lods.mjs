/**
 * Build tiled LOD system from full solar data.
 *
 * LOD0: single file, 5° grid - zoom 0-3
 * LOD1: 30x30° tiles, 2° grid - zoom 3-6
 * LOD2: 10x10° tiles, 0.5° grid - zoom 6+
 *
 * Output: public/solar/lod0.json, public/solar/lod1/*.json, public/solar/lod2/*.json
 * Run: node scripts/build-lods.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'public', 'solar-data.json')
const OUT_DIR = path.join(ROOT, 'public', 'solar')

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const validPoints = data.grid.filter(pt => pt[2] !== null)
console.log(`  Source: ${validPoints.length} valid points`)

const meta = {
  year: data.year,
  source: data.source,
  months: data.months,
  stats: data.stats,
}

// Clean output
fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT_DIR, 'lod1'), { recursive: true })
fs.mkdirSync(path.join(OUT_DIR, 'lod2'), { recursive: true })

// ── LOD0: downsample to 5° ──
const LOD0_STEP = 5
const lod0Buckets = new Map()

for (const pt of validPoints) {
  const lat = Math.round(pt[0] / LOD0_STEP) * LOD0_STEP
  const lon = Math.round(pt[1] / LOD0_STEP) * LOD0_STEP
  const key = `${lat},${lon}`
  if (!lod0Buckets.has(key)) lod0Buckets.set(key, [])
  lod0Buckets.get(key).push(pt)
}

const lod0Grid = []
for (const [key, pts] of lod0Buckets) {
  const [lat, lon] = key.split(',').map(Number)
  lod0Grid.push(avgValues(lat, lon, pts))
}
lod0Grid.sort((a, b) => a[0] - b[0] || a[1] - b[1])

const lod0 = { ...meta, step: LOD0_STEP, grid: lod0Grid }
fs.writeFileSync(path.join(OUT_DIR, 'lod0.json'), JSON.stringify(lod0))
console.log(`  LOD0: ${lod0Grid.length} points (${fsize(path.join(OUT_DIR, 'lod0.json'))})`)

// ── LOD1: 30x30° tiles, downsample to 2° ──
const LOD1_TILE = 30
const LOD1_STEP = 2
const lod1Tiles = new Map()

for (const pt of validPoints) {
  const tLat = Math.floor(pt[0] / LOD1_TILE) * LOD1_TILE
  const tLon = Math.floor(pt[1] / LOD1_TILE) * LOD1_TILE
  const tileKey = `${tLat}_${tLon}`
  if (!lod1Tiles.has(tileKey)) lod1Tiles.set(tileKey, [])
  lod1Tiles.get(tileKey).push(pt)
}

let lod1Count = 0
let lod1Files = 0
for (const [tileKey, pts] of lod1Tiles) {
  // Downsample to 2°
  const buckets = new Map()
  for (const pt of pts) {
    const lat = Math.round(pt[0] / LOD1_STEP) * LOD1_STEP
    const lon = Math.round(pt[1] / LOD1_STEP) * LOD1_STEP
    const key = `${lat},${lon}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(pt)
  }
  const grid = []
  for (const [key, bpts] of buckets) {
    const [lat, lon] = key.split(',').map(Number)
    grid.push(avgValues(lat, lon, bpts))
  }
  grid.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  fs.writeFileSync(
    path.join(OUT_DIR, 'lod1', `${tileKey}.json`),
    JSON.stringify({ step: LOD1_STEP, grid })
  )
  lod1Count += grid.length
  lod1Files++
}
console.log(`  LOD1: ${lod1Count} points in ${lod1Files} tiles (2° step, 30x30° tiles)`)

// ── LOD2: 10x10° tiles, full 0.5° resolution ──
const LOD2_TILE = 10
const lod2Tiles = new Map()

for (const pt of validPoints) {
  const tLat = Math.floor(pt[0] / LOD2_TILE) * LOD2_TILE
  const tLon = Math.floor(pt[1] / LOD2_TILE) * LOD2_TILE
  const tileKey = `${tLat}_${tLon}`
  if (!lod2Tiles.has(tileKey)) lod2Tiles.set(tileKey, [])
  lod2Tiles.get(tileKey).push(pt)
}

let lod2Count = 0
let lod2Files = 0
for (const [tileKey, pts] of lod2Tiles) {
  const grid = pts.map(pt => [...pt])
  grid.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  fs.writeFileSync(
    path.join(OUT_DIR, 'lod2', `${tileKey}.json`),
    JSON.stringify({ step: 0.5, grid })
  )
  lod2Count += grid.length
  lod2Files++
}
console.log(`  LOD2: ${lod2Count} points in ${lod2Files} tiles (0.5° step, 10x10° tiles)`)

// ── Manifest ──
const manifest = {
  ...meta,
  lods: [
    { level: 0, step: LOD0_STEP, file: 'lod0.json', minZoom: 0, maxZoom: 3 },
    { level: 1, step: LOD1_STEP, tileSize: LOD1_TILE, dir: 'lod1', minZoom: 3, maxZoom: 6 },
    { level: 2, step: 0.5, tileSize: LOD2_TILE, dir: 'lod2', minZoom: 6, maxZoom: 18 },
  ],
}
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`  Manifest: ${path.join(OUT_DIR, 'manifest.json')}`)

// Total size
const totalSize = dirSize(OUT_DIR)
console.log(`  Total: ${(totalSize / 1024 / 1024).toFixed(1)} MB`)
console.log('')

// ── Helpers ──

function avgValues(lat, lon, pts) {
  const n = pts.length
  const ghiM = Array(12).fill(0)
  const tmpM = Array(12).fill(0)
  let ghiA = 0, tmpA = 0

  for (const pt of pts) {
    for (let m = 0; m < 12; m++) { ghiM[m] += pt[2][m]; tmpM[m] += pt[4][m] }
    ghiA += pt[3]; tmpA += pt[5]
  }

  return [
    lat, lon,
    ghiM.map(v => r2(v / n)), r2(ghiA / n),
    tmpM.map(v => r1(v / n)), r1(tmpA / n),
  ]
}

function r2(n) { return Math.round(n * 100) / 100 }
function r1(n) { return Math.round(n * 10) / 10 }

function fsize(f) {
  const s = fs.statSync(f).size
  return s > 1024 * 1024 ? `${(s / 1024 / 1024).toFixed(1)} MB` : `${(s / 1024).toFixed(0)} KB`
}

function dirSize(dir) {
  let total = 0
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f)
    const st = fs.statSync(fp)
    total += st.isDirectory() ? dirSize(fp) : st.size
  }
  return total
}
