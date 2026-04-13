<template>
  <Transition name="modal">
    <div v-if="open" class="methodology-overlay" @click.self="$emit('close')">
      <div class="methodology-panel">
        <button class="methodology-close" @click="$emit('close')">&times;</button>
        <h2 class="methodology-title">Methodology</h2>

        <div class="methodology-body">
          <section>
            <h3>Data Source</h3>
            <p>
              Solar irradiance data comes from <strong>NASA POWER</strong> (Prediction of Worldwide Energy Resources),
              which uses the <strong>CERES</strong> satellite-derived Surface Shortwave Downward (ALLSKY_SFC_SW_DWN)
              dataset. Values represent the 20-year climatological average (2001–2020) of surface shortwave radiation
              reaching the ground, measured in kWh/m²/day.
            </p>
          </section>

          <section>
            <h3>Grid Resolution</h3>
            <p>
              The global dataset is sampled at 1° latitude × 1° longitude resolution (approximately 111 km at the equator),
              yielding ~57,600 valid data points worldwide. For visualization, the data is displayed at a 5° aggregated
              grid (LOD0) for fast initial loading. Higher-resolution tiles (2° and 0.5°) are available for detailed
              point lookups.
            </p>
          </section>

          <section>
            <h3>Solar Irradiance (GHI)</h3>
            <p>
              Global Horizontal Irradiance (GHI) represents the total amount of shortwave radiation received on a
              horizontal surface at the Earth's surface. This includes both direct normal irradiance (beam) and diffuse
              horizontal irradiance. Monthly values show average daily irradiance for each calendar month.
            </p>
          </section>

          <section>
            <h3>PV Output Estimation</h3>
            <p>
              Photovoltaic output is estimated using the following model:
            </p>
            <div class="methodology-formula">
              PV = GHI × η × (1 + γ × max(0, T<sub>cell</sub> − 25°C)) × λ
            </div>
            <div class="methodology-formula" style="margin-top: 6px; font-size: 12px;">
              T<sub>cell</sub> = T<sub>2M</sub> + 20 × (GHI / 5)
            </div>
            <p>Where:</p>
            <ul>
              <li><strong>η = 20%</strong> — Panel efficiency (standard monocrystalline)</li>
              <li><strong>γ = −0.004 /°C</strong> — Temperature coefficient of power</li>
              <li><strong>T<sub>cell</sub></strong> — Estimated cell temperature under irradiance</li>
              <li><strong>T<sub>2M</sub></strong> — Surface air temperature (NASA POWER, 24h mean)</li>
              <li><strong>20 × GHI/5</strong> — NOCT-based cell heating, proportional to irradiance. At 5 kWh/m²/day (mid-latitude clear sky) the offset is +20°C; at low irradiance (e.g. 2 kWh/m²/day) only +8°C. Based on NOCT ≈ 45°C.</li>
              <li><strong>λ = 0.86</strong> — System losses (inverter, wiring, soiling, degradation)</li>
            </ul>
            <p>
              The cell temperature model accounts for the fact that PV panels heat up in proportion
              to solar irradiance. In desert climates with strong sun and high ambient temperatures,
              cells can exceed 55°C, losing 12%+ efficiency. In cool, overcast regions, cells barely
              warm above ambient and losses are minimal.
            </p>
          </section>

          <section>
            <h3>Sunny Days</h3>
            <p>
              City-level "sunny days per year" data is compiled from multiple meteorological sources
              (WMO, Weather Atlas, CurrentResults, Weatherbase) and represents the average number of
              days with predominantly clear skies.
            </p>
          </section>

          <section>
            <h3>Color Scale</h3>
            <p>
              The color ramp maps linearly from the dataset minimum to maximum. For GHI mode, the
              range is approximately 0–8 kWh/m²/day. For PV mode, the range is 0–1.2 kWh/m²/day.
              Blue tones indicate lower irradiance, green represents moderate levels, and orange/red
              indicates high solar resource areas.
            </p>
          </section>

          <section class="methodology-credits">
            <h3>Credits</h3>
            <p>
              Data: NASA Langley Research Center POWER Project<br />
              Basemap: CARTO / OpenStreetMap contributors<br />
              Visualization: Méridien
            </p>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()
</script>

<style lang="scss">
.methodology-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.methodology-panel {
  position: relative;
  width: 560px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 80px);
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: 32px;
  overflow-y: auto;
  backdrop-filter: blur(24px);
}

.methodology-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: none;
  border: none;
  color: var(--c-text-dim);
  font-size: 24px;
  cursor: pointer;
  line-height: 1;
  padding: 4px;
  transition: color 0.2s;
  &:hover { color: var(--c-text); }
}

.methodology-title {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  color: var(--c-text);
  margin-bottom: 24px;
}

.methodology-body {
  display: flex;
  flex-direction: column;
  gap: 20px;

  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h3 {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--c-text-accent);
  }

  p {
    font-size: 13px;
    line-height: 1.7;
    color: var(--c-text-secondary);
  }

  ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--c-text-secondary);

    li::before {
      content: '·';
      margin-right: 8px;
      color: var(--c-text-dim);
    }
  }

  strong {
    color: var(--c-text);
    font-weight: 500;
  }
}

.methodology-formula {
  font-family: 'Courier New', monospace;
  font-size: 14px;
  color: var(--c-text);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  text-align: center;
}

.methodology-credits {
  border-top: 1px solid var(--c-border);
  padding-top: 16px;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;

  .methodology-panel {
    transition: transform 0.3s var(--ease), opacity 0.25s ease;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .methodology-panel {
    opacity: 0;
    transform: translateY(20px) scale(0.97);
  }
}
</style>
