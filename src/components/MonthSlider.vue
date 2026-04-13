<template>
  <div class="month-bar">
    <button
      :class="['mp mp--year', { active: month === 'annual' }]"
      @click="$emit('update:month', 'annual')"
    >Year</button>
    <span class="mp-sep" />
    <div
      ref="pillsRef"
      class="month-pills"
      @mousedown="onDragStart"
      @touchstart.prevent="onTouchStart"
    >
      <button
        v-for="(label, i) in monthLabels"
        :key="i"
        :class="['mp', { active: month === i }]"
        @click="$emit('update:month', i as MonthIndex)"
      >{{ label }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { MonthIndex, DataMode } from '../data/solar-service'

const props = defineProps<{
  month: MonthIndex
  mode: DataMode
}>()

const emit = defineEmits<{
  'update:month': [value: MonthIndex]
  'update:mode': [value: DataMode]
}>()

const monthLabels = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const pillsRef = ref<HTMLElement>()

function xToMonth(clientX: number): number {
  const el = pillsRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const t = (clientX - rect.left) / rect.width
  return Math.max(0, Math.min(11, Math.round(t * 11)))
}

function onDragStart(e: MouseEvent) {
  const startX = e.clientX
  let moved = false
  document.body.style.cursor = 'grabbing'

  function onMove(ev: MouseEvent) {
    if (!moved && Math.abs(ev.clientX - startX) < 4) return
    moved = true
    const m = xToMonth(ev.clientX)
    emit('update:month', m as MonthIndex)
  }

  function onUp() {
    document.body.style.cursor = ''
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onTouchStart(e: TouchEvent) {
  function onMove(ev: TouchEvent) {
    const m = xToMonth(ev.touches[0].clientX)
    emit('update:month', m as MonthIndex)
  }

  function onEnd() {
    window.removeEventListener('touchmove', onMove)
    window.removeEventListener('touchend', onEnd)
  }

  window.addEventListener('touchmove', onMove)
  window.addEventListener('touchend', onEnd)
}
</script>

<style lang="scss">
.month-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 11;
  display: flex;
  align-items: center;
  gap: 0;
}

.mp-sep {
  width: 1px;
  height: 12px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 6px;
  align-self: center;
}

.mp {
  min-width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.03em;
  color: var(--c-text-muted);
  background: none;
  border: none;
  border-radius: 13px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
  flex-shrink: 0;

  &:hover {
    color: var(--c-text-secondary);
    background: rgba(255, 255, 255, 0.05);
  }

  &.active {
    color: var(--c-text);
    font-weight: 600;
    background: rgba(255, 255, 255, 0.1);
    cursor: grab;
  }
}


.month-pills {
  display: flex;
  align-items: center;
  gap: 2px;
  touch-action: none;
}

@media (max-width: 768px) {
  .month-bar {
    bottom: 16px;
  }

  .mp {
    min-width: 22px;
    height: 22px;
    font-size: 9px;
    padding: 0 4px;
    border-radius: 11px;
  }

  .mp-sep {
    height: 10px;
    margin: 0 4px;
  }

  .month-pills {
    gap: 1px;
  }
}
</style>
