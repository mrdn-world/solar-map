<template>
  <Transition name="tip">
    <div
      v-if="location"
      class="tooltip"
      :style="{ transform: `translate(${x + 16}px, ${y - 12}px)` }"
    >
      <div class="tooltip-city">{{ location.city }}</div>
      <div class="tooltip-country">{{ location.country }}</div>
      <div class="tooltip-days">
        <span class="tooltip-dot" :style="{ background: categoryColors[location.category] }" />
        {{ location.sunnyDays }} sunny days per year
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { categoryColors, type LocationData } from '../data/sunny-days'

defineProps<{
  location: LocationData | null
  x: number
  y: number
}>()
</script>

<style lang="scss">
.tooltip {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 100;
  pointer-events: none;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 10px 14px;
  backdrop-filter: blur(12px);
  white-space: nowrap;
}

.tooltip-city {
  font-weight: 600;
  font-size: 14px;
  color: var(--c-text);
}

.tooltip-country {
  font-size: 12px;
  color: var(--c-text-dim);
  margin-bottom: 6px;
}

.tooltip-days {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text);
}

.tooltip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tip-enter-active,
.tip-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.tip-enter-from,
.tip-leave-to {
  opacity: 0;
}
</style>
