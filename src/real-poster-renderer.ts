const WIDTH = 1080
const HEIGHT = 1440
const GAP = 12

type Rect = { x: number; y: number; width: number; height: number }

function layoutRects(layout: string, count: number): Rect[] {
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

export async function renderRealPosterPage(page: ImagePlanPage, photos: RealPhoto[], sources: Record<string, string>) {
  const selected = (page.sourcePhotoIds || []).map((id) => photos.find((photo) => photo.id === id)).filter(Boolean) as RealPhoto[]
  if (!selected.length) throw new Error(`${page.label}没有可用的实拍图片`)
  const loaded = await Promise.all(selected.map((photo) => loadImage(sources[photo.id])))
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前环境不支持宣传图渲染')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, WIDTH, HEIGHT)
  const rects = layoutRects(page.layoutTemplateId || '', selected.length)
  loaded.forEach((image, index) => drawCover(context, image, rects[index] || rects[0], selected[index].tags.visualTags.subjectPosition))

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
