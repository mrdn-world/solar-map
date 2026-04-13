<template>
  <Transition name="panel">
    <aside v-if="selected" class="dashboard">
      <button class="dashboard-close" @click="$emit('close')" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div class="dashboard-header">
        <div class="dashboard-city">{{ selected.city }}</div>
        <div class="dashboard-country">{{ selected.country }}</div>
      </div>

      <div class="dashboard-scroll">

      <!-- Sunny days — warm, open -->
      <div class="sun-hero">
        <div class="sun-hero-number" :style="{ color: categoryColors[selected.category] }">
          {{ selected.sunnyDays }}
        </div>
        <div class="sun-hero-label">sunny days per year</div>
        <div class="sun-hero-bar">
          <div class="sun-hero-bar-fill"
            :style="{ width: `${(selected.sunnyDays / 365) * 100}%`, background: categoryColors[selected.category] }" />
        </div>
        <div class="sun-hero-sub">{{ Math.round((selected.sunnyDays / 365) * 100) }}% of the year</div>
      </div>

      <!-- GHI by month -->
      <div v-if="comboChart" class="dashboard-section">
        <div class="dashboard-section-title">Sunshine energy · {{ ghiCurrentLabel }} <span class="section-unit">kWh/m² per day</span></div>
        <div class="sparkline-chart">
          <svg class="sparkline-svg" viewBox="0 -16 272 120">
            <template v-for="(bar, i) in comboChart" :key="'ghi'+i">
              <rect :x="bar.x" :y="bar.ghiY" :width="barW" :height="98 - bar.ghiY"
                :fill="barActive(i) ? 'rgba(255,180,0,0.30)' : 'rgba(255,180,0,0.10)'" rx="2" />
            </template>
            <line v-if="month !== 'annual'"
              :x1="barX(month as number) + barW/2" y1="2"
              :x2="barX(month as number) + barW/2" y2="98"
              stroke="rgba(255,255,255,0.12)" stroke-width="1" stroke-dasharray="2 2" />
            <!-- Peak -->
            <g v-if="peakBar">
              <polygon :points="`${barX(peakIdx)+barW/2-4},${peakBar.ghiY-6} ${barX(peakIdx)+barW/2+4},${peakBar.ghiY-6} ${barX(peakIdx)+barW/2},${peakBar.ghiY-1}`"
                fill="rgba(255,180,0,0.7)" />
              <text :x="barX(peakIdx)+barW/2" :y="peakBar.ghiY-9"
                text-anchor="middle" fill="rgba(255,180,0,0.8)" font-size="7" font-weight="600">PEAK</text>
            </g>
            <!-- Low -->
            <g v-if="lowBar">
              <polygon :points="`${barX(lowIdx)+barW/2-4},${lowBar.ghiY-6} ${barX(lowIdx)+barW/2+4},${lowBar.ghiY-6} ${barX(lowIdx)+barW/2},${lowBar.ghiY-1}`"
                fill="rgba(100,160,255,0.7)" />
              <text :x="barX(lowIdx)+barW/2" :y="lowBar.ghiY-9"
                text-anchor="middle" fill="rgba(100,160,255,0.8)" font-size="7" font-weight="600">LOW</text>
            </g>
            <!-- Month labels -->
            <text v-for="(l, i) in sparkLabels" :key="'glbl'+i"
              :x="barX(i) + barW/2" y="110"
              text-anchor="middle" fill="rgba(255,255,255,0.3)" font-size="8">{{ l }}</text>
          </svg>
        </div>
      </div>

      <!-- Global context (GHI among cities) -->
      <div v-if="rangeChart" class="dashboard-section">
        <div class="dashboard-section-title">Global context · GHI</div>
        <div class="range-chart">
          <svg class="range-svg" viewBox="0 0 272 64">
            <!-- Track -->
            <line x1="16" y1="30" x2="256" y2="30"
              stroke="rgba(255,255,255,0.08)" stroke-width="8" stroke-linecap="round" />
            <!-- IQR band -->
            <line :x1="rangeChart.p25X" y1="30" :x2="rangeChart.p75X" y2="30"
              stroke="rgba(255,255,255,0.06)" stroke-width="20" stroke-linecap="round" />
            <!-- Min -->
            <g class="range-marker range-marker--click" @click="emit('select', rangeChart.minCity)">
              <line :x1="rangeChart.minX" y1="20" :x2="rangeChart.minX" y2="40"
                stroke="rgba(255,255,255,0.3)" stroke-width="2" />
              <text v-if="rangeChart.showMin" :x="rangeChart.minX" y="15" text-anchor="start"
                fill="rgba(255,255,255,0.35)" font-size="9">{{ rangeChart.minLabel }}</text>
              <text v-if="rangeChart.showMin" :x="rangeChart.minX" y="55" text-anchor="start"
                fill="rgba(255,255,255,0.45)" font-size="9">{{ rangeChart.minCity.city }}</text>
            </g>
            <!-- Median -->
            <g class="range-marker range-marker--click" @click="emit('select', rangeChart.medianCity)">
              <line :x1="rangeChart.medianX" y1="20" :x2="rangeChart.medianX" y2="40"
                stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="2 2" />
              <circle :cx="rangeChart.medianX" cy="30" r="3.5"
                fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.4)" stroke-width="1" />
              <text :x="rangeChart.medianX" y="55" text-anchor="middle"
                fill="rgba(255,255,255,0.45)" font-size="9">{{ rangeChart.medianCity.city }}</text>
            </g>
            <!-- Max -->
            <g class="range-marker range-marker--click" @click="emit('select', rangeChart.maxCity)">
              <line :x1="rangeChart.maxX" y1="20" :x2="rangeChart.maxX" y2="40"
                stroke="rgba(255,255,255,0.3)" stroke-width="2" />
              <text v-if="rangeChart.showMax" :x="rangeChart.maxX" y="15" text-anchor="end"
                fill="rgba(255,255,255,0.35)" font-size="9">{{ rangeChart.maxLabel }}</text>
              <text v-if="rangeChart.showMax" :x="rangeChart.maxX" y="55" text-anchor="end"
                fill="rgba(255,255,255,0.45)" font-size="9">{{ rangeChart.maxCity.city }}</text>
            </g>
            <!-- Current -->
            <circle :cx="rangeChart.currentX" cy="30" r="6.5"
              :fill="accentColor" stroke="rgba(0,0,0,0.6)" stroke-width="1.5" />
            <text :x="rangeChart.curLabelX" y="34"
              :text-anchor="rangeChart.curAnchor"
              :fill="accentColor" font-size="10" font-weight="600">{{ rangeChart.currentLabel }}</text>
          </svg>
        </div>
        <div class="range-legend">{{ rangeChart.percentileLabel }}</div>
      </div>

      <!-- PV output — technical card -->
      <div v-if="annualPVTotal !== '--'" class="pv-card">
        <div class="pv-card-header">
          <span class="pv-card-badge">PV OUTPUT</span>
          <span class="pv-card-unit">kWh/m² per year</span>
        </div>
        <div class="pv-card-number">{{ annualPVTotal }}</div>
        <div v-if="pvBarPct" class="pv-card-bar-wrap">
          <div class="pv-card-bar">
            <div class="pv-card-bar-fill" :style="{ width: pvBarPct + '%' }" />
          </div>
          <div class="pv-card-bar-label">{{ pvBarPct }}% of global max</div>
        </div>
      </div>

      <!-- PV + T°Loss by month -->
      <div v-if="pvChart" class="dashboard-section">
        <div class="dashboard-section-title">PV output · {{ pvCurrentLabel }} <span class="section-unit">kWh/m² per day</span></div>
        <div class="sparkline-chart">
          <svg class="sparkline-svg" viewBox="0 0 272 110">
            <template v-for="(bar, i) in pvChart" :key="'pv'+i">
              <!-- T°Loss zone -->
              <rect v-if="bar.lossH > 0.3"
                :x="bar.x" :y="bar.pvY - bar.lossH" :width="barW" :height="bar.lossH"
                :fill="barActive(i) ? 'rgba(249,124,148,0.6)' : 'rgba(249,124,148,0.12)'" rx="1" />
              <!-- Actual PV -->
              <rect :x="bar.x" :y="bar.pvY" :width="barW" :height="98 - bar.pvY"
                :fill="barActive(i) ? 'rgba(97,226,107,0.75)' : 'rgba(97,226,107,0.15)'" rx="2" />
            </template>
            <line v-if="month !== 'annual'"
              :x1="barX(month as number) + barW/2" y1="2"
              :x2="barX(month as number) + barW/2" y2="98"
              stroke="rgba(255,255,255,0.12)" stroke-width="1" stroke-dasharray="2 2" />
            <!-- Month labels -->
            <text v-for="(l, i) in sparkLabels" :key="'plbl'+i"
              :x="barX(i) + barW/2" y="110"
              text-anchor="middle" fill="rgba(255,255,255,0.3)" font-size="8">{{ l }}</text>
          </svg>
        </div>
        <div class="sparkline-legend">
          <span class="sparkline-legend-item">
            <span class="sparkline-legend-swatch" style="background:rgba(97,226,107,0.6)"></span>
            PV output
          </span>
          <span class="sparkline-legend-item">
            <span class="sparkline-legend-swatch sparkline-legend-swatch--loss"></span>
            T°Loss {{ penaltyCurrentLabel }}
          </span>
        </div>
        <div v-if="lossNote" class="sparkline-note">{{ lossNote }}</div>
      </div>

      <div class="dashboard-coords">
        {{ selected.lat.toFixed(2) }}°{{ selected.lat >= 0 ? 'N' : 'S' }},
        {{ selected.lon.toFixed(2) }}°{{ selected.lon >= 0 ? 'E' : 'W' }}
      </div>

      </div><!-- /dashboard-scroll -->
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { locations, categoryColors, type LocationData } from '../data/sunny-days'
import { loadSolarData, calcPVOutput, tempPenaltyFraction, cellTemp, type MonthIndex, type DataMode, type SolarGridV2 } from '../data/solar-service'

const props = defineProps<{
  selected: LocationData | null
  month: MonthIndex
  mode: DataMode
}>()

const emit = defineEmits<{
  close: []
  select: [loc: LocationData]
}>()

const solarData = ref<SolarGridV2 | null>(null)
loadSolarData().then(d => { solarData.value = d })

const accentColor = computed(() =>
  props.selected ? categoryColors[props.selected.category] : '#FFB800'
)

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const sparkLabels = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

const nearestPoint = computed(() => {
  if (!props.selected || !solarData.value) return null
  const { lat, lon } = props.selected
  const step = solarData.value.step
  let bestDist = Infinity
  let best: SolarGridV2['grid'][0] | null = null
  for (const pt of solarData.value.grid) {
    if (pt[2] === null) continue
    const dlat = pt[0] - lat
    const dlon = pt[1] - lon
    const dist = dlat * dlat + dlon * dlon
    if (dist < bestDist) { bestDist = dist; best = pt }
    if (dist < step * step * 0.25) break
  }
  return best
})

const monthlyGHI = computed(() => {
  const pt = nearestPoint.value
  if (!pt || pt[2] === null) return null
  return pt[2] as number[]
})

const monthlyTemp = computed(() => {
  const pt = nearestPoint.value
  if (!pt || pt[2] === null) return null
  return pt[4] as number[]
})

const monthlyPV = computed(() => {
  const ghi = monthlyGHI.value
  const temp = monthlyTemp.value
  if (!ghi || !temp) return null
  return ghi.map((g, i) => calcPVOutput(g, temp[i] as number))
})

// ── Combined chart: GHI + PV + TLoss ──
// All on the same GHI scale (0–8 kWh/m²/day), SVG height 100, bars 2→98
const GHI_MAX = 8
const CHART_TOP = 2
const CHART_BOT = 98
const CHART_H = CHART_BOT - CHART_TOP  // 96px usable

const barW = 252 / 12 - 3
function barX(i: number): number { return (i / 12) * 252 + 10 }

function barActive(i: number): boolean {
  return props.month === 'annual' || props.month === i
}

const PANEL_EFF = 0.20
const SYSTEM_LOSS = 0.86

const comboChart = computed(() => {
  if (!monthlyGHI.value || !monthlyPV.value || !monthlyTemp.value) return null
  return monthlyGHI.value.map((ghi, i) => {
    const theoreticalPV = ghi * PANEL_EFF * SYSTEM_LOSS  // PV without temp loss
    const actualPV = monthlyPV.value![i]
    const tempLoss = Math.max(0, theoreticalPV - actualPV)
    // Map to SVG Y (top = high value, bottom = 0)
    const ghiY = CHART_BOT - (ghi / GHI_MAX) * CHART_H
    const actualPvY = CHART_BOT - (actualPV / GHI_MAX) * CHART_H
    const lossH = (tempLoss / GHI_MAX) * CHART_H
    return { x: barX(i), ghiY, actualPvY, lossH }
  })
})

// ── PV chart (own scale) ──
const PV_MAX = 1.5
const pvChart = computed(() => {
  if (!monthlyGHI.value || !monthlyPV.value || !monthlyTemp.value) return null
  return monthlyGHI.value.map((ghi, i) => {
    const theoreticalPV = ghi * PANEL_EFF * SYSTEM_LOSS
    const actualPV = monthlyPV.value![i]
    const tempLoss = Math.max(0, theoreticalPV - actualPV)
    const pvY = CHART_BOT - (actualPV / PV_MAX) * CHART_H
    const lossH = (tempLoss / PV_MAX) * CHART_H
    return { x: barX(i), pvY, lossH }
  })
})

const ghiCurrentLabel = computed(() => {
  if (!monthlyGHI.value) return ''
  if (props.month === 'annual') {
    const pt = nearestPoint.value
    const v = pt && pt[2] !== null ? (pt[3] as number).toFixed(2) : '--'
    return `avg ${v}`
  }
  const v = monthlyGHI.value[props.month as number]?.toFixed(2) ?? '--'
  return `${monthNames[props.month as number]}: ${v}`
})

const pvCurrentLabel = computed(() => {
  if (!monthlyPV.value) return ''
  if (props.month === 'annual') {
    const pt = nearestPoint.value
    if (!pt || pt[2] === null) return ''
    const v = calcPVOutput(pt[3] as number, pt[5] as number).toFixed(2)
    return `avg ${v}`
  }
  const v = monthlyPV.value[props.month as number]?.toFixed(2) ?? '--'
  return `${monthNames[props.month as number]}: ${v}`
})

const penaltyCurrentLabel = computed(() => {
  if (!monthlyTemp.value || !monthlyGHI.value) return '--'
  if (props.month === 'annual') {
    let totalLoss = 0
    for (let i = 0; i < 12; i++) {
      totalLoss += tempPenaltyFraction(monthlyTemp.value[i], monthlyGHI.value[i]) * 100
    }
    const avg = totalLoss / 12
    return avg > 0.05 ? `−${avg.toFixed(1)}%` : '0%'
  }
  const i = props.month as number
  const loss = tempPenaltyFraction(monthlyTemp.value[i], monthlyGHI.value[i]) * 100
  return loss > 0.05 ? `−${loss.toFixed(1)}%` : '0%'
})

const lossNote = computed(() => {
  if (!monthlyTemp.value || !monthlyGHI.value) return ''
  // Find month with max and min penalty
  let maxLoss = 0, minLoss = Infinity, maxCellT = 0, minCellT = Infinity
  for (let i = 0; i < 12; i++) {
    const t = monthlyTemp.value[i], g = monthlyGHI.value[i]
    const ct = cellTemp(t, g)
    const loss = tempPenaltyFraction(t, g) * 100
    if (loss > maxLoss) { maxLoss = loss; maxCellT = ct }
    if (loss < minLoss) { minLoss = loss; minCellT = ct }
  }
  return `Cell temp ${minCellT.toFixed(0)}–${maxCellT.toFixed(0)}°C (NOCT model, scales with GHI) · loss ${minLoss.toFixed(1)}–${maxLoss.toFixed(1)}%`
})

// Seasonal stats — always based on GHI (stable across mode switches)
const peakIdx = computed(() => {
  if (!monthlyGHI.value) return 0
  let best = 0
  for (let i = 1; i < 12; i++) if (monthlyGHI.value[i] > monthlyGHI.value[best]) best = i
  return best
})

const lowIdx = computed(() => {
  if (!monthlyGHI.value) return 0
  let best = 0
  for (let i = 1; i < 12; i++) if (monthlyGHI.value[i] < monthlyGHI.value[best]) best = i
  return best
})

const peakBar = computed(() => comboChart.value?.[peakIdx.value])
const lowBar = computed(() => comboChart.value?.[lowIdx.value])

const annualPVTotal = computed(() => {
  const pt = nearestPoint.value
  if (!pt || pt[2] === null) return '--'
  return (calcPVOutput(pt[3] as number, pt[5] as number) * 365).toFixed(0)
})

// PV bar — percentage of global max PV
const pvBarPct = computed(() => {
  const pt = nearestPoint.value
  if (!pt || pt[2] === null || !solarData.value) return null
  const myPV = calcPVOutput(pt[3] as number, pt[5] as number)
  // Find max PV among all grid points
  let maxPV = 0
  for (const g of solarData.value.grid) {
    if (g[2] === null) continue
    const pv = calcPVOutput(g[3] as number, g[5] as number)
    if (pv > maxPV) maxPV = pv
  }
  return maxPV > 0 ? Math.round((myPV / maxPV) * 100) : null
})

// Global range chart — always PV, based on cities from locations[], clickable
// Computes metric value for each city, finds min/median/max cities

interface CityMetric { loc: LocationData; value: number }
let cityMetricsCache: { mode: DataMode; sorted: CityMetric[] } | null = null

function getCityMetrics(mode: DataMode): CityMetric[] {
  if (cityMetricsCache && cityMetricsCache.mode === mode) return cityMetricsCache.sorted
  if (!solarData.value) return []
  const results: CityMetric[] = []
  for (const loc of locations) {
    // Find nearest grid point
    let best: SolarGridV2['grid'][0] | null = null
    let bestDist = Infinity
    for (const pt of solarData.value.grid) {
      if (pt[2] === null) continue
      const d = (pt[0] - loc.lat) ** 2 + (pt[1] - loc.lon) ** 2
      if (d < bestDist) { bestDist = d; best = pt }
    }
    if (!best || best[2] === null) continue
    const ghi = best[3] as number
    const temp = best[5] as number
    let v: number
    if (mode === 'pv') v = calcPVOutput(ghi, temp)
    else if (mode === 'temp-penalty') v = tempPenaltyFraction(temp, ghi) * 100
    else v = ghi
    results.push({ loc, value: v })
  }
  results.sort((a, b) => a.value - b.value)
  cityMetricsCache = { mode, sorted: results }
  return results
}

const rangeChart = computed(() => {
  const pt = nearestPoint.value
  if (!solarData.value || !pt || pt[2] === null) return null
  const sorted = getCityMetrics('ghi')
  if (sorted.length < 3) return null

  const minEntry = sorted[0]
  const maxEntry = sorted[sorted.length - 1]
  const medIdx = Math.floor(sorted.length / 2)
  const medEntry = sorted[medIdx]
  const p25Entry = sorted[Math.floor(sorted.length * 0.25)]
  const p75Entry = sorted[Math.floor(sorted.length * 0.75)]

  const lo = minEntry.value
  const hi = maxEntry.value
  const range = hi - lo
  if (range <= 0) return null

  const LEFT = 16, RIGHT = 256, W = RIGHT - LEFT
  function toX(v: number): number {
    return LEFT + Math.max(0, Math.min(1, (v - lo) / range)) * W
  }

  const myVal = pt[3] as number

  let rank = 0
  for (const c of sorted) { if (c.value <= myVal) rank++; else break }
  const pctile = Math.round((rank / sorted.length) * 100)

  const fmt = (v: number) => v.toFixed(2)

  const cX = toX(myVal)
  const MID = (LEFT + RIGHT) / 2
  const curLabelSide: 'right' | 'left' = cX < MID ? 'right' : 'left'

  const NEAR = 30
  const showMin = Math.abs(cX - toX(lo)) > NEAR
  const showMax = Math.abs(cX - toX(hi)) > NEAR

  return {
    minX: toX(lo), maxX: toX(hi),
    medianX: toX(medEntry.value),
    p25X: toX(p25Entry.value), p75X: toX(p75Entry.value),
    currentX: cX,
    minCity: minEntry.loc, maxCity: maxEntry.loc, medianCity: medEntry.loc,
    minLabel: fmt(lo), maxLabel: fmt(hi), currentLabel: fmt(myVal),
    percentileLabel: `Top ${100 - pctile}% — higher than ${pctile}% of ${sorted.length} cities`,
    curLabelX: curLabelSide === 'right' ? cX + 10 : cX - 10,
    curAnchor: curLabelSide === 'right' ? 'start' : 'end',
    showMin, showMax,
  }
})
</script>

<style lang="scss">
.dashboard {
  position: absolute;
  top: 24px;
  right: 24px;
  bottom: 24px;
  z-index: 20;
  width: 320px;
  background: rgba(15, 15, 15, 0.85);
  border: 1px solid var(--c-border);
  border-radius: 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(24px);
  overflow: hidden;
}

.dashboard-close {
  position: absolute;
  top: 20px;
  right: 16px;
  z-index: 1;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  color: var(--c-text-dim);
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    color: var(--c-text);
    background: rgba(255, 255, 255, 0.08);
  }
}

.dashboard-header {
  flex-shrink: 0;
  padding: 24px 24px 16px;
  padding-right: 48px;
  border-bottom: 1px solid var(--c-border);
}

.dashboard-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.dashboard-city {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
}

.dashboard-country {
  font-size: 14px;
  color: var(--c-text-dim);
  margin-top: 4px;
}

// ── Sunny days hero — warm, airy ──
.sun-hero {
  display: flex;
  flex-direction: column;
}

.sun-hero-number {
  font-family: var(--font-display);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.sun-hero-label {
  font-size: 13px;
  color: var(--c-text-dim);
  margin-top: 4px;
}

.sun-hero-bar {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 12px;
}

.sun-hero-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.6s var(--ease);
}

.sun-hero-sub {
  font-size: 11px;
  color: var(--c-text-dim);
  margin-top: 4px;
  opacity: 0.6;
}

// ── PV card — technical, contained ──
.pv-card {
  background: rgba(97, 226, 107, 0.04);
  border: 1px solid rgba(97, 226, 107, 0.12);
  border-radius: 12px;
  padding: 16px;
}

.pv-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.pv-card-badge {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: rgba(97, 226, 107, 0.7);
  background: rgba(97, 226, 107, 0.08);
  padding: 3px 8px;
  border-radius: 4px;
}

.pv-card-unit {
  font-size: 10px;
  color: var(--c-text-dim);
  opacity: 0.6;
}

.pv-card-number {
  font-size: 40px;
  font-weight: 700;
  line-height: 1;
  color: rgba(97, 226, 107, 0.9);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-body);
  letter-spacing: -0.01em;
}

.pv-card-bar-wrap {
  margin-top: 12px;
}

.pv-card-bar {
  width: 100%;
  height: 3px;
  background: rgba(97, 226, 107, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.pv-card-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: rgba(97, 226, 107, 0.4);
  transition: width 0.6s var(--ease);
}

.pv-card-bar-label {
  font-size: 10px;
  color: var(--c-text-dim);
  margin-top: 4px;
  opacity: 0.6;
}

.dashboard-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dashboard-section-title {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-text-dim);

  .section-unit {
    opacity: 0.5;
    font-weight: 400;
  }
}

// Sparkline bar chart
.sparkline-chart {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sparkline-svg {
  width: 100%;
  height: 100px;
}


.sparkline-legend {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--c-text-secondary);
}

.sparkline-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.sparkline-legend-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;

  &--loss {
    background: rgba(249,124,148,0.5);
  }
}

.sparkline-note {
  font-size: 10px;
  color: var(--c-text-dim);
  line-height: 1.4;
}


// Range chart
.range-chart {
  background: rgba(255, 255, 255, 0.02);
  border-radius: var(--radius-sm);
  padding: 4px 0;
}

.range-svg {
  width: 100%;
  height: 72px;
}

.range-legend {
  font-size: 11px;
  color: var(--c-text-dim);
  line-height: 1.4;
}

.range-marker--click {
  cursor: pointer;
  &:hover {
    line { stroke: rgba(255,255,255,0.7); }
    text { fill: rgba(255,255,255,0.8) !important; }
    circle { fill: rgba(255,255,255,0.5); }
  }
}

.dashboard-coords {
  margin-top: auto;
  font-size: 11px;
  color: var(--c-text-dim);
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

// Transition
.panel-enter-active,
.panel-leave-active {
  transition: transform 0.4s var(--ease), opacity 0.3s ease;
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

@media (max-width: 768px) {
  .dashboard {
    top: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    border-radius: 0;
    border: none;
  }

  .dashboard-header {
    padding: 16px 16px 12px;
    padding-right: 48px;
  }

  .dashboard-scroll {
    padding: 16px;
    gap: 16px;
  }

  .dashboard-city {
    font-size: 22px;
  }

  .sun-hero-number {
    font-size: 48px;
  }

  .pv-card-number {
    font-size: 32px;
  }

  .panel-enter-from,
  .panel-leave-to {
    transform: translateY(100%);
  }
}
</style>
