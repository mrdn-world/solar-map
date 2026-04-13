// Fetches solar irradiance climatology from NASA POWER regional API
// Gets entire latitude bands in single requests — much faster than point-by-point
//
// Run: node scripts/fetch-solar-data.mjs
// Output: public/solar-data.json

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(__dirname, '..', 'public', 'solar-data.json')

// NASA POWER regional API supports max 10° lat × full lon bands
const LON_MIN = -180, LON_MAX = 180
const LAT_BAND = 10
const DELAY = 2000

console.log(`\n  NASA POWER Solar Data Downloader (Regional API)`)
console.log(`  ─────────────────────────────────────────────────`)

const bands = []
for (let lat = -90; lat < 90; lat += LAT_BAND) {
  bands.push({ latMin: lat, latMax: Math.min(lat + LAT_BAND, 90) })
}

console.log(`  Fetching ${bands.length} latitude bands...`)
console.log(`  Source: CERES SYN1deg / MERRA-2 (2001-2020 climatology)\n`)

const allPoints = []
const t0 = Date.now()

for (let i = 0; i < bands.length; i++) {
  const { latMin, latMax } = bands[i]
  const pct = ((i + 1) / bands.length * 100).toFixed(0)
  process.stdout.write(`  [${pct}%] Band ${i + 1}/${bands.length}: lat ${latMin}° to ${latMax}°...`)

  const url = `https://power.larc.nasa.gov/api/temporal/climatology/regional?parameters=ALLSKY_SFC_SW_DWN&community=RE&latitude-min=${latMin}&latitude-max=${latMax}&longitude-min=${LON_MIN}&longitude-max=${LON_MAX}&format=JSON&start=2001&end=2020`

  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      console.log(` HTTP ${resp.status}`)
      if (resp.status === 429) {
        console.log(`  ⏳ Rate limited, waiting 30s...`)
        await sleep(30000)
        i--
        continue
      }
      continue
    }

    const data = await resp.json()

    // Regional API returns features with geometry and properties
    const features = data?.features
    if (features && features.length > 0) {
      for (const feat of features) {
        const coords = feat.geometry?.coordinates
        const ann = feat.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN
        if (coords && ann !== undefined && ann > 0) {
          // coords = [lon, lat]
          const hours = Math.round(ann * 365 * 0.75)
          allPoints.push([coords[1], coords[0], hours])
        }
      }
      console.log(` ✓ ${features.length} points`)
    } else {
      // Maybe different response format — try parsing as grid
      const params = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN
      if (params) {
        // Single region value
        const ann = params.ANN
        if (ann > 0) {
          const midLat = (latMin + latMax) / 2
          for (let lon = LON_MIN; lon < LON_MAX; lon += 3) {
            allPoints.push([midLat, lon, Math.round(ann * 365 * 0.75)])
          }
        }
        console.log(` ✓ (aggregated)`)
      } else {
        console.log(` ✗ no data`)
      }
    }
  } catch (e) {
    console.log(` ✗ ${e.message}`)
  }

  if (i < bands.length - 1) await sleep(DELAY)
}

console.log(`\n  Received ${allPoints.length} points total`)

// If regional API didn't give enough granularity, fall back to point queries for a coarser grid
if (allPoints.length < 500) {
  console.log(`  Regional API returned insufficient data, falling back to point queries...`)
  console.log(`  Using 5° grid for speed...\n`)

  const STEP = 5
  const lats = [], lons = []
  for (let lat = -80; lat <= 80; lat += STEP) lats.push(lat)
  for (let lon = -180; lon < 180; lon += STEP) lons.push(lon)

  const total = lats.length * lons.length
  let done = 0

  for (const lat of lats) {
    for (const lon of lons) {
      done++
      const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&format=JSON&start=2001&end=2020`

      try {
        const resp = await fetch(url)
        if (resp.ok) {
          const data = await resp.json()
          const ann = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN
          if (ann > 0) {
            allPoints.push([lat, lon, Math.round(ann * 365 * 0.75)])
          }
        } else if (resp.status === 429) {
          await sleep(15000)
          done--
          continue
        }
      } catch {}

      if (done % 20 === 0) {
        const pct = (done / total * 100).toFixed(1)
        const elapsed = (Date.now() - t0) / 1000
        const eta = Math.ceil((total - done) * (elapsed / done))
        process.stdout.write(`\r  ${pct}% (${done}/${total}) ETA: ${Math.floor(eta/60)}m${eta%60}s   `)
      }

      await sleep(400)
    }
  }
  console.log('')
}

// Compute stats & save
const hours = allPoints.map(p => p[2])
const min = Math.min(...hours)
const max = Math.max(...hours)
const avg = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length)

// Determine step from data
const uniqueLats = [...new Set(allPoints.map(p => p[0]))].sort((a, b) => a - b)
const step = uniqueLats.length > 1 ? Math.round(uniqueLats[1] - uniqueLats[0]) : 5

const output = {
  step,
  year: '2001-2020 climatology',
  source: 'NASA POWER (CERES SYN1deg / MERRA-2)',
  stats: { min, max, avg, count: allPoints.length, total: allPoints.length },
  grid: allPoints,
}

writeFileSync(OUT_PATH, JSON.stringify(output))

const elapsed = ((Date.now() - t0) / 60000).toFixed(1)
console.log(`\n  ✓ Done! ${allPoints.length} points`)
console.log(`  ✓ Range: ${min}–${max} sunshine-equivalent hours/year (avg: ${avg})`)
console.log(`  ✓ Saved to public/solar-data.json`)
console.log(`  ✓ Elapsed: ${elapsed} minutes\n`)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
