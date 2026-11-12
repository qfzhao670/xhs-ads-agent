const WIDTH = 1080
const HEIGHT = 1440
const GAP = 12

type Rect = { x: number; y: number; width: number; height: number }

export type RealPosterLayout = { id: string; name: string; description: string; count: number }

export const REAL_POSTER_LAYOUTS: RealPosterLayout[] = [
  { id: 'single', name: '单图通栏', description: '一张图片铺满整张画布', count: 1 },
  { id: 'split-vertical', name: '左右对照', description: '两张图片等宽并排', count: 2 },
  { id: 'split-horizontal', name: '上下分镜', description: '两张图片上下均分', count: 2 },
  { id: 'hero-two', name: '主图 + 补充', description: '主图突出，底部补一张细节', count: 2 },
  { id: 'left-three', name: '左主右双', description: '左侧主图，右侧两张补充图', count: 3 },
  { id: 'hero-three', name: '上主下双', description: '上方主图，下方并列两张', count: 3 },
  { id: 'hero-four', name: '上主下三', description: '一张主图配三张细节图', count: 4 },
  { id: 'grid-four', name: '四宫格', description: '四张图片等比陈列', count: 4 },
]

export function defaultRealPosterLayout(count: number) {
  return ({ 1: 'single', 2: 'hero-two', 3: 'hero-three', 4: 'hero-four' } as Record<number, string>)[count] || 'single'
}

export function realPosterLayoutRects(layout: string, count: number): Rect[] {
  if (count <= 1) return [{ x: 0, y: 0, width: WIDTH, height: HEIGHT }]
  if (layout === 'split-vertical') return [
    { x: 0, y: 0, width: (WIDTH - GAP) / 2, height: HEIGHT },
    { x: (WIDTH + GAP) / 2, y: 0, width: (WIDTH - GAP) / 2, height: HEIGHT },
  ]
  if (layout === 'split-horizontal') return [
    { x: 0, y: 0, width: WIDTH, height: (HEIGHT - GAP) / 2 },
    { x: 0, y: (HEIGHT + GAP) / 2, width: WIDTH, height: (HEIGHT - GAP) / 2 },
  ]
  if (layout === 'hero-two') return [
    { x: 0, y: 0, width: WIDTH, height: 900 },
    { x: 0, y: 900 + GAP, width: WIDTH, height: HEIGHT - 900 - GAP },
  ]
  if (layout === 'left-three') return [
    { x: 0, y: 0, width: 650, height: HEIGHT },
    { x: 650 + GAP, y: 0, width: WIDTH - 650 - GAP, height: (HEIGHT - GAP) / 2 },
    { x: 650 + GAP, y: (HEIGHT + GAP) / 2, width: WIDTH - 650 - GAP, height: (HEIGHT - GAP) / 2 },
  ]
  if (layout === 'hero-three') return [
    { x: 0, y: 0, width: WIDTH, height: 870 },
    { x: 0, y: 870 + GAP, width: (WIDTH - GAP) / 2, height: HEIGHT - 870 - GAP },
    { x: (WIDTH + GAP) / 2, y: 870 + GAP, width: (WIDTH - GAP) / 2, height: HEIGHT - 870 - GAP },
  ]
  if (layout === 'hero-four') return [
    { x: 0, y: 0, width: WIDTH, height: 820 },
    ...Array.from({ length: 3 }, (_, index) => ({
      x: index * ((WIDTH - GAP * 2) / 3 + GAP), y: 820 + GAP,
      width: (WIDTH - GAP * 2) / 3, height: HEIGHT - 820 - GAP,
    })),
  ]
  return Array.from({ length: 4 }, (_, index) => ({
    x: (index % 2) * ((WIDTH + GAP) / 2), y: Math.floor(index / 2) * ((HEIGHT + GAP) / 2),
    width: (WIDTH - GAP) / 2, height: (HEIGHT - GAP) / 2,
  }))
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法读取实拍图片'))
    image.src = source
  })
}

function focalPoint(position: string) {
  const value = position.toLowerCase()
  return {
    x: value.includes('left') ? 0.3 : value.includes('right') ? 0.7 : 0.5,
    y: value.includes('top') ? 0.3 : value.includes('bottom') ? 0.7 : 0.5,
  }
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, rect: Rect, position: string) {
  const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
  const sourceWidth = rect.width / scale
  const sourceHeight = rect.height / scale
  const focal = focalPoint(position)
  const sourceX = Math.max(0, Math.min(image.naturalWidth - sourceWidth, image.naturalWidth * focal.x - sourceWidth / 2))
  const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceHeight, image.naturalHeight * focal.y - sourceHeight / 2))
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, rect.x, rect.y, rect.width, rect.height)
}

function wrapTitle(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const character of text) {
    const candidate = `${line}${character}`
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = character
    } else line = candidate
  }
  if (line) lines.push(line)
  return lines.slice(0, 2)
}

async function renderRealPoster(page: ImagePlanPage, photos: RealPhoto[], sources: Record<string, string>, allowEmptySlots: boolean, drawTextLayer: boolean) {
  const slots = (page.sourcePhotoIds || []).map((id) => photos.find((photo) => photo.id === id) || null)
  const selected = slots.filter(Boolean) as RealPhoto[]
  if (!selected.length && !allowEmptySlots) throw new Error(`${page.label}没有可用的实拍图片`)
  const loaded = await Promise.all(slots.map(async (photo) => {
    if (!photo || !sources[photo.id]) return null
    try { return await loadImage(sources[photo.id]) } catch (error) {
      if (!allowEmptySlots) throw error
      return null
    }
  }))
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前环境不支持宣传图渲染')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, WIDTH, HEIGHT)
  const slotCount = Math.max(1, slots.length)
  const layout = page.layoutTemplateId || defaultRealPosterLayout(slotCount)
  const rects = realPosterLayoutRects(layout, slotCount)
  loaded.forEach((image, index) => {
    const rect = rects[index] || rects[0]
    const photo = slots[index]
    if (image && photo) {
      drawCover(context, image, rect, photo.tags.visualTags.subjectPosition)
      return
    }
    context.fillStyle = '#dfe9e5'
    context.fillRect(rect.x, rect.y, rect.width, rect.height)
    context.save()
    context.setLineDash([18, 14])
    context.lineWidth = 4
    context.strokeStyle = '#86a49a'
    context.strokeRect(rect.x + 22, rect.y + 22, Math.max(0, rect.width - 44), Math.max(0, rect.height - 44))
    context.restore()
    context.fillStyle = '#47675d'
    context.font = '700 28px "PingFang SC", "Microsoft YaHei", Arial, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(`待选择图片 ${index + 1}`, rect.x + rect.width / 2, rect.y + rect.height / 2)
    context.textAlign = 'left'
    context.textBaseline = 'top'
  })

  if (!drawTextLayer) return canvas.toDataURL('image/png')

  const top = page.textPosition === 'top'
  const gradient = context.createLinearGradient(0, top ? 0 : HEIGHT, 0, top ? 470 : HEIGHT - 520)
  gradient.addColorStop(0, 'rgba(8, 12, 20, .86)')
  gradient.addColorStop(1, 'rgba(8, 12, 20, 0)')
  context.fillStyle = gradient
  context.fillRect(0, top ? 0 : HEIGHT - 540, WIDTH, 540)

  const title = String(page.title || page.promotionTheme || '').trim()
  const titleSize = title.length > 15 ? 76 : title.length > 10 ? 84 : 94
  context.font = `900 ${titleSize}px "PingFang SC", "Microsoft YaHei", Arial, sans-serif`
  context.lineJoin = 'round'
  context.textBaseline = 'top'
  const lines = wrapTitle(context, title, 900)
  const lineHeight = titleSize * 1.13
  const titleY = top ? 78 : HEIGHT - 90 - lineHeight * lines.length - (page.subtitle ? 72 : 0)
  lines.forEach((line, index) => {
    const y = titleY + index * lineHeight
    context.strokeStyle = 'rgba(0, 0, 0, .9)'
    context.lineWidth = 18
    context.strokeText(line, 72, y)
    context.fillStyle = '#ffffff'
    context.fillText(line, 72, y)
  })

  const accent = /^#[0-9a-f]{6}$/i.test(page.accentColor || '') ? page.accentColor! : '#ffd43b'
  context.fillStyle = accent
  context.fillRect(72, titleY - 20, Math.min(250, 78 + title.length * 10), 12)
  if (page.subtitle) {
    context.font = '700 36px "PingFang SC", "Microsoft YaHei", Arial, sans-serif'
    const subtitleWidth = Math.min(880, context.measureText(page.subtitle).width + 54)
    const subtitleY = titleY + lines.length * lineHeight + 16
    context.fillStyle = accent
    context.fillRect(72, subtitleY, subtitleWidth, 58)
    context.fillStyle = '#111827'
    context.fillText(page.subtitle, 98, subtitleY + 9)
  }

  return canvas.toDataURL('image/png')
}

export async function renderRealPosterPage(page: ImagePlanPage, photos: RealPhoto[], sources: Record<string, string>) {
  return renderRealPoster(page, photos, sources, false, true)
}

export async function renderRealPosterPreview(page: ImagePlanPage, photos: RealPhoto[], sources: Record<string, string>) {
  return renderRealPoster(page, photos, sources, true, true)
}

export async function renderRealPosterBasePage(page: ImagePlanPage, photos: RealPhoto[], sources: Record<string, string>) {
  return renderRealPoster(page, photos, sources, false, false)
}
