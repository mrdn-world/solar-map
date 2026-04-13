<template>
  <div class="export-panel">
    <button class="export-btn" @click="showMenu = !showMenu" title="Export">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </button>

    <Transition name="menu">
      <div v-if="showMenu" class="export-menu">
        <div class="export-menu-title">Export</div>
        <button
          v-for="preset in presets"
          :key="preset.label"
          class="export-menu-item"
          @click="doExport(preset)"
        >
          <span class="export-menu-item-label">{{ preset.label }}</span>
          <span v-if="preset.w" class="export-menu-item-size">{{ preset.w }}&times;{{ preset.h }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const showMenu = ref(false)

interface Preset {
  label: string
  w: number
  h: number
}

const presets: Preset[] = [
  { label: 'Poster (A2)', w: 7016, h: 4961 },
  { label: 'Poster (A3)', w: 4961, h: 3508 },
  { label: 'Instagram Post', w: 1080, h: 1080 },
  { label: 'Instagram Story', w: 1080, h: 1920 },
  { label: 'OG Image', w: 1200, h: 630 },
  { label: 'Twitter / X', w: 1200, h: 675 },
  { label: 'Screen (4K)', w: 3840, h: 2160 },
  { label: 'Current View', w: 0, h: 0 },
]

// Load the logo SVG as an Image (cached)
let logoImg: HTMLImageElement | null = null
function loadLogo(): Promise<HTMLImageElement> {
  if (logoImg) return Promise.resolve(logoImg)
  return new Promise((resolve) => {
    const img = new Image()
    // Inline the SVG with white fill for export
    const svg = `<svg width="89" height="56" viewBox="0 0 89 55.8155" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.8248 34.6053L9.13341 16.8121L8.72748 9.77599L3.99164 44.8889L5.07412 52.8722L5.00646 53.2781H0L0.0676549 52.8722L1.89434 44.8889L6.69783 8.76117L6.49487 2.94285L6.56252 2.53692H13.8693L15.1547 16.3385L15.6283 23.3746L17.9962 16.3385L23.138 2.53692H30.6477L30.58 2.94285L29.0239 8.89648L23.8145 47.7304V52.8722L23.7469 53.2781H15.7636L15.8312 52.8722L17.1167 47.7304L22.1908 9.84365L19.7552 16.8798L13.125 34.6053H10.8248Z" fill="#61E26B"/>
      <path d="M51.3094 39.0709C52.9853 48.9237 56.8049 55.8155 61.2557 55.8155C65.7066 55.8155 69.5261 48.9237 71.202 39.0709H51.3094ZM87.1488 19.5355H74.3265C74.6587 22.3132 74.8254 25.1093 74.8254 27.9078C74.8254 30.7064 74.6587 33.5025 74.3265 36.2801H87.1488C88.8105 30.8295 88.8105 24.9862 87.1488 19.5355ZM86.1218 16.7448C84.462 12.8518 81.9603 9.3996 78.807 6.65114C75.6536 3.90268 71.932 1.93042 67.9255 0.884584C71.1841 5.5722 73.248 11.0252 73.9281 16.7448H86.1218ZM50.4 27.9078C50.3968 30.7064 50.5633 33.5028 50.8985 36.2801H71.6129C71.948 33.5028 72.1147 30.7064 72.1114 27.9078C72.1147 25.1093 71.948 22.3129 71.6129 19.5355H50.8985C50.5633 22.3129 50.3968 25.1093 50.4 27.9078ZM67.9255 54.9311C71.932 53.8851 75.6536 51.9129 78.807 49.1645C81.9603 46.4162 84.462 42.964 86.1218 39.0709H73.9281C73.248 44.7906 71.1841 50.2434 67.9255 54.9311ZM47.6861 27.9078C47.686 25.1093 47.8526 22.3132 48.1849 19.5355H35.3627C33.701 24.9862 33.701 30.8295 35.3627 36.2801H48.1849C47.8526 33.5025 47.686 30.7064 47.6861 27.9078ZM36.3896 39.0709C38.0493 42.964 40.5511 46.4162 43.7044 49.1645C46.8577 51.9129 50.5794 53.8851 54.586 54.9311C51.3272 50.2434 49.2634 44.7906 48.5833 39.0709H36.3896ZM54.586 0.884584C50.5794 1.93056 46.8578 3.90285 43.7045 6.65131C40.5513 9.39976 38.0495 12.8519 36.3896 16.7448H48.5833C49.2634 11.0252 51.3272 5.5722 54.586 0.884584ZM71.202 16.7448C69.5261 6.89338 65.7066 0.000190973 61.2557 0.000190973C56.8049 0.000190973 52.9853 6.89338 51.3094 16.7448H71.202Z" fill="#61E26B"/>
    </svg>`
    img.onload = () => { logoImg = img; resolve(img) }
    img.onerror = () => resolve(img) // proceed without logo
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
}

async function doExport(preset: Preset) {
  showMenu.value = false

  const logo = await loadLogo()

  // Get map instance for rendering
  const mapEl = document.querySelector('.globe-map-canvas') as any
  const mapInstance = mapEl?.__mapInstance

  // Hide CARTO country labels for clean export
  if (mapInstance && mapInstance.getLayer('labels')) {
    mapInstance.setLayoutProperty('labels', 'visibility', 'none')
  }

  // Capture map: render a fresh frame and grab it as an image
  const mapImage = await new Promise<HTMLImageElement | null>((resolve) => {
    if (!mapInstance) {
      const c = document.querySelector('.maplibregl-canvas') as HTMLCanvasElement | null
      if (!c) { resolve(null); return }
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      try { img.src = c.toDataURL() } catch { resolve(null) }
      return
    }
    mapInstance.once('render', () => {
      const c = mapInstance.getCanvas() as HTMLCanvasElement
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      try { img.src = c.toDataURL() } catch { resolve(null) }
    })
    mapInstance.triggerRepaint()
  })

  // Restore labels
  if (mapInstance && mapInstance.getLayer('labels')) {
    mapInstance.setLayoutProperty('labels', 'visibility', 'visible')
    mapInstance.triggerRepaint()
  }

  if (!mapImage) return

  const sw = mapImage.naturalWidth
  const sh = mapImage.naturalHeight

  const exportCanvas = document.createElement('canvas')
  const w = preset.w || sw
  const h = preset.h || sh
  exportCanvas.width = w
  exportCanvas.height = h

  const ctx = exportCanvas.getContext('2d')
  if (!ctx) return

  const u = w / 100

  // Dark background
  ctx.fillStyle = '#08090d'
  ctx.fillRect(0, 0, w, h)

  // Draw map
  const scale = Math.max(w / sw, h / sh)
  const dx = (w - sw * scale) / 2
  const dy = (h - sh * scale) / 2
  ctx.drawImage(mapImage, dx, dy, sw * scale, sh * scale)

    // Top-left gradient overlay for text readability
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.5)
    grad.addColorStop(0, 'rgba(8,9,13,0.7)')
    grad.addColorStop(1, 'rgba(8,9,13,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h * 0.4)

    // Logo
    const pad = u * 3
    const logoH = u * 4
    const logoW = logoH * (89 / 56)
    if (logo.complete && logo.naturalWidth > 0) {
      ctx.globalAlpha = 0.9
      ctx.drawImage(logo, pad, pad, logoW, logoH)
      ctx.globalAlpha = 1
    }

    // Kicker: "Solar Atlas"
    const kickerY = pad + logoH + u * 2
    const kickerSize = Math.round(u * 1.1)
    ctx.font = `500 ${kickerSize}px 'Inter', system-ui, sans-serif`
    ctx.fillStyle = '#61E26B'
    ctx.letterSpacing = '0.15em'
    ctx.fillText('SOLAR ATLAS', pad, kickerY)

    // Title
    const titleSize = Math.round(u * 3.5)
    ctx.font = `700 ${titleSize}px 'Struve', 'Playfair Display', Georgia, serif`
    ctx.fillStyle = '#e8e6e3'
    ctx.letterSpacing = '0'
    const titleY = kickerY + titleSize * 1.1
    ctx.fillText('Where the Sun', pad, titleY)
    ctx.fillText('Shines Most', pad, titleY + titleSize * 1.1)

    // Subtitle
    const subSize = Math.round(u * 1.2)
    ctx.font = `400 ${subSize}px 'Inter', system-ui, sans-serif`
    ctx.fillStyle = 'rgba(232,230,227,0.5)'
    ctx.fillText('Explore how much sunshine each place on Earth receives.', pad, titleY + titleSize * 1.1 + u * 2.5)

    // Bottom bar
    ctx.fillStyle = 'rgba(8,9,13,0.5)'
    ctx.fillRect(0, h - u * 4, w, u * 4)

    // Bottom-left: data source
    const footSize = Math.round(u * 0.9)
    ctx.font = `400 ${footSize}px 'Inter', system-ui, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.textAlign = 'left'
    ctx.fillText('Data: NASA POWER CERES · Visualization: Méridien', pad, h - u * 1.5)


    // Download
    exportCanvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `solar-map-${preset.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
}
</script>

<style lang="scss">
.export-panel {
  position: relative;
}

.export-btn {
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

.export-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 8px;
  min-width: 200px;
  backdrop-filter: blur(24px);
}

.export-menu-title {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-text-dim);
  padding: 6px 10px 8px;
}

.export-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 10px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--c-text);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--c-surface-hover);
  }
}

.export-menu-item-size {
  font-size: 11px;
  color: var(--c-text-dim);
  font-variant-numeric: tabular-nums;
}

.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.2s ease, transform 0.2s var(--ease);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 768px) {
  .export-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    svg { width: 14px; height: 14px; }
  }
}
</style>
