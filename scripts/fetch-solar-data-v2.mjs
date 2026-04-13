/**
 * Fetch monthly solar irradiance + temperature from NASA POWER regional API.
 * Uses batch 10x10 degree tiles instead of point-by-point.
 *
 * Each tile cached in temp/solar-tiles/ for resilience + resumability.
 * Assembles final public/solar-data.json at the end.
 *
 * Run: node scripts/fetch-solar-data-v2.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import https from 'https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TEMP_DIR = path.join(ROOT, 'temp', 'solar-tiles')
const OUT = path.join(ROOT, 'public', 'solar-data.json')

const TILE_SIZE = 10          // 10x10 degree tiles (API max)
const WORKERS = 3             // parallel requests
const MAX_RETRIES = 5
const RETRY_DELAY = 2000
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const PARAMS = ['ALLSKY_SFC_SW_DWN', 'T2M']

// Build tile grid
const tiles = []
for (let lat = -80; lat < 80; lat += TILE_SIZE) {
  for (let lon = -180; lon < 180; lon += TILE_SIZE) {
    for (const param of PARAMS) {
      tiles.push({ lat, lon, latMax: lat + TILE_SIZE, lonMax: lon + TILE_SIZE, param })
    }
  }
}

console.log('')
console.log('  NASA POWER Solar Data v2 (batch tiles)')
console.log('  ---------------------------------------')
console.log(`  Tiles: ${tiles.length} (${TILE_SIZE}deg, 2 params)`)
console.log(`  Workers: ${WORKERS}`)
console.log(`  Temp: ${TEMP_DIR}`)
console.log('')

fs.mkdirSync(TEMP_DIR, { recursive: true })

function tileFile(lat, lon, param) {
  return path.join(TEMP_DIR, `${param}_${lat}_${lon}.json`)
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'solar-map/2.0' }, timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function fetchTile(tile) {
  const file = tileFile(tile.lat, tile.lon, tile.param)

  // Check cache
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {}
  }

  const url =
    `https://power.larc.nasa.gov/api/temporal/climatology/regional?` +
    `parameters=${tile.param}&community=RE` +
    `&latitude-min=${tile.lat}&latitude-max=${tile.latMax}` +
    `&longitude-min=${tile.lon}&longitude-max=${tile.lonMax}` +
    `&format=JSON&start=2001&end=2020`

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const data = await fetchJSON(url)

      if (!data.features || !data.features.length) {
        const result = { tile, features: [] }
        fs.writeFileSync(file, JSON.stringify(result))
        return result
      }

      // Extract point data
      const points = data.features.map(f => {
        const coords = f.geometry.coordinates
        const paramData = f.properties?.parameter?.[tile.param] || {}
        return {
          lon: coords[0],
          lat: coords[1],
          monthly: MONTHS.map(m => paramData[m] ?? null),
          ann: paramData.ANN ?? null,
        }
      }).filter(p => p.ann !== null && p.ann > -900) // filter NASA fill values

      const result = { tile: { lat: tile.lat, lon: tile.lon, param: tile.param }, points }
      fs.writeFileSync(file, JSON.stringify(result))
      return result
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY * (attempt + 1))
      } else {
        console.error(`\n  FAIL: ${tile.param} [${tile.lat},${tile.lon}]: ${err.message}`)
        const result = { tile: { lat: tile.lat, lon: tile.lon, param: tile.param }, points: [], error: err.message }
        fs.writeFileSync(file, JSON.stringify(result))
        return result
      }
    }
  }
}

// Worker pool
async function runPool(items, worker, concurrency) {
  let idx = 0
  let done = 0
  const total = items.length
  const t0 = Date.now()

  async function next() {
    while (idx < total) {
      const i = idx++
      await worker(items[i])
      done++
      if (done % 10 === 0 || done === total) {
        const pct = (done / total * 100).toFixed(1)
        const elapsed = (Date.now() - t0) / 1000
        const rate = done / elapsed
        const eta = Math.round((total - done) / rate)
        const bar = '#'.repeat(Math.floor(done / total * 40)).padEnd(40, '.')
        process.stdout.write(`\r  ${bar} ${pct}% (${done}/${total}) ETA: ${Math.floor(eta/60)}m${eta%60}s   `)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => next()))
  console.log('')
}

// Fetch all tiles
const tileResults = []
await runPool(tiles, async (tile) => {
  const result = await fetchTile(tile)
  tileResults.push(result)
}, WORKERS)

// Merge: combine GHI and T2M by lat/lon
const ghiMap = new Map()  // "lat,lon" -> { monthly, ann }
const t2mMap = new Map()

for (const result of tileResults) {
  const param = result.tile.param
  const target = param === 'ALLSKY_SFC_SW_DWN' ? ghiMap : t2mMap
  for (const pt of result.points) {
    const key = `${pt.lat},${pt.lon}`
    target.set(key, { monthly: pt.monthly, ann: pt.ann })
  }
}

console.log(`  GHI points: ${ghiMap.size}`)
console.log(`  T2M points: ${t2mMap.size}`)

// Build grid: merge GHI + T2M, downsample to 5deg step
// The regional API returns 1deg grid, we'll keep all of it for better resolution
const allKeys = new Set([...ghiMap.keys(), ...t2mMap.keys()])
const grid = []
const ghiVals = []

for (const key of allKeys) {
  const [latStr, lonStr] = key.split(',')
  const lat = parseFloat(latStr)
  const lon = parseFloat(lonStr)
  const ghi = ghiMap.get(key)
  const t2m = t2mMap.get(key)

  if (!ghi || ghi.ann <= 0) {
    grid.push([lat, lon, null])
    continue
  }

  const monthlyGhi = ghi.monthly.map(v => round2(v))
  const annGhi = round2(ghi.ann)
  const monthlyTemp = t2m ? t2m.monthly.map(v => round1(v)) : Array(12).fill(20)
  const annTemp = t2m ? round1(t2m.ann) : 20

  // Validate
  const ok = monthlyGhi.every(v => v >= 0 && v < 15) && monthlyTemp.every(v => v > -80 && v < 65)
  if (!ok) {
    grid.push([lat, lon, null])
    continue
  }

  grid.push([lat, lon, monthlyGhi, annGhi, monthlyTemp, annTemp])
  ghiVals.push(annGhi)
}

// Sort by lat, lon
grid.sort((a, b) => a[0] - b[0] || a[1] - b[1])

const valid = grid.filter(g => g[2] !== null)
console.log(`  Valid grid points: ${valid.length}/${grid.length}`)

if (ghiVals.length === 0) {
  console.log('  ERROR: No valid data!')
  process.exit(1)
}

const ghiMin = round2(Math.min(...ghiVals))
const ghiMax = round2(Math.max(...ghiVals))
const ghiAvg = round2(ghiVals.reduce((a, b) => a + b, 0) / ghiVals.length)

// Detect step from data
const latSet = [...new Set(grid.map(g => g[0]))].sort((a, b) => a - b)
const step = latSet.length > 1 ? round2(latSet[1] - latSet[0]) : 5

const output = {
  step,
  year: '2001-2020 climatology',
  source: 'NASA POWER (CERES SYN1deg / MERRA-2)',
  months: MONTHS,
  stats: { ghi_min: ghiMin, ghi_max: ghiMax, ghi_avg: ghiAvg, count: valid.length, total: grid.length },
  grid,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(output))

const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1)
console.log(`  GHI range: ${ghiMin}-${ghiMax} kWh/m2/day (avg: ${ghiAvg})`)
console.log(`  File: ${OUT} (${sizeMB} MB)`)
console.log('')

function round2(n) { return Math.round(n * 100) / 100 }
function round1(n) { return Math.round(n * 10) / 10 }
