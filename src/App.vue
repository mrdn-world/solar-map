<template>
  <div class="app">
    <GlobeMap
      :selected="selected"
      :hovered="hovered"
      :month="month"
      :mode="mode"
      @select="onSelect"
      @hover="onHover"
    />

    <header class="header">
      <img src="/assets/meridian-logo.svg" alt="Méridien" class="header-logo" />
      <h1 class="header-title">
        <span class="header-kicker">Solar Atlas</span>
        Where the Sun<br />Shines Most
      </h1>
      <p class="header-sub">
        Explore how much sunshine each place on Earth receives.
        Click any city to see sunny days, solar energy, and PV potential.
      </p>
    </header>

    <Dashboard
      :selected="selected"
      :month="month"
      :mode="mode"
      @close="selected = null"
      @select="onSelect"
    />

    <Legend />

    <MonthSlider
      :month="month"
      :mode="mode"
      @update:month="month = $event"
      @update:mode="mode = $event"
    />

    <Transition name="fade-actions">
      <div v-if="!selected" class="top-actions">
        <button class="action-btn" title="Methodology" @click="showMethodology = true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        <ExportPanel />
      </div>
    </Transition>

    <Methodology :open="showMethodology" @close="showMethodology = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import GlobeMap from './components/GlobeMap.vue'
import Dashboard from './components/Dashboard.vue'
import MonthSlider from './components/MonthSlider.vue'
import ExportPanel from './components/ExportPanel.vue'
import Legend from './components/Legend.vue'
import Methodology from './components/Methodology.vue'
import type { LocationData } from './data/sunny-days'
import type { MonthIndex, DataMode } from './data/solar-service'

const selected = ref<LocationData | null>(null)
const hovered = ref<LocationData | null>(null)
const month = ref<MonthIndex>('annual')
const mode = ref<DataMode>('ghi')
const showMethodology = ref(false)


function onSelect(loc: LocationData | null) { selected.value = loc }
function onHover(loc: LocationData | null) { hovered.value = loc }
</script>

<style lang="scss">
.app {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.header {
  position: absolute;
  top: 24px;
  left: 24px;
  z-index: 10;
  max-width: 420px;
  pointer-events: none;
}

.header-logo {
  width: 48px;
  height: auto;
  margin-bottom: 20px;
  opacity: 0.9;
}

.header-kicker {
  display: block;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--c-text-accent);
  margin-bottom: 8px;
}

.header-title {
  font-family: var(--font-display);
  font-size: 42px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--c-text);
  margin-bottom: 16px;
}

.header-sub {
  font-size: 14px;
  line-height: 1.6;
  color: var(--c-text-dim);
}

.top-actions {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 15;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.action-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  color: var(--c-text-dim);
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(12px);

  &:hover {
    color: var(--c-text);
    background: var(--c-surface-hover);
  }
}

@media (max-width: 768px) {
  .header {
    top: 16px;
    left: 16px;
    max-width: 260px;
  }

  .header-logo {
    width: 32px;
    margin-bottom: 12px;
  }

  .header-kicker {
    font-size: 9px;
    margin-bottom: 4px;
  }

  .header-title {
    font-size: 24px;
    margin-bottom: 8px;
  }

  .header-sub {
    font-size: 11px;
    line-height: 1.4;
  }

  .top-actions {
    top: 16px;
    right: 16px;
    gap: 6px;
  }

  .action-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    svg { width: 14px; height: 14px; }
  }
}

.fade-actions-enter-active,
.fade-actions-leave-active {
  transition: opacity 0.3s ease;
}

.fade-actions-enter-from,
.fade-actions-leave-to {
  opacity: 0;
}
</style>
