<template>
  <div class="legend">
    <div class="legend-title">Sunshine intensity</div>
    <div class="legend-row">
      <span class="legend-edge">☁</span>
      <canvas ref="rampCanvas" class="legend-canvas" width="200" height="10" />
      <span class="legend-edge">☀</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const rampCanvas = ref<HTMLCanvasElement>()

function drawRamp() {
  const canvas = rampCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height

  const stops: [number, number, number, number][] = [
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

  for (let x = 0; x < w; x++) {
    const t = x / (w - 1)
    let r = 0, g = 0, b = 0
    for (let i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1][0]) {
        const s = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])
        r = Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * s)
        g = Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * s)
        b = Math.round(stops[i][3] + (stops[i + 1][3] - stops[i][3]) * s)
        break
      }
    }
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(x, 0, 1, h)
  }
}

onMounted(drawRamp)
</script>

<style lang="scss">
.legend {
  position: absolute;
  bottom: 24px;
  left: 24px;
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.legend-title {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-text-secondary);
  text-align: center;
}

.legend-row {
  display: flex;
  align-items: flex-end;
  gap: 5px;
}

.legend-edge {
  font-size: 11px;
  line-height: 1;
  opacity: 0.5;
}

.legend-canvas {
  display: block;
  width: 120px;
  height: 8px;
  border-radius: 4px;
  opacity: 0.85;
}

@media (max-width: 768px) {
  .legend {
    bottom: 48px;
    left: 16px;
  }

  .legend-title {
    font-size: 8px;
  }

  .legend-edge {
    font-size: 9px;
  }

  .legend-canvas {
    width: 80px;
    height: 6px;
  }
}
</style>
