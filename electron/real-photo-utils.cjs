const LAYOUTS_BY_COUNT = {
  1: ['single-full', 'single-caption'],
  2: ['split-vertical', 'split-horizontal', 'hero-two'],
  3: ['hero-three', 'left-three'],
  4: ['grid-four', 'hero-four'],
}

function stringList(value, limit = 12) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit) : []
}

function sanitizeRealPhotoTags(value = {}) {
  const visual = value.visualTags && typeof value.visualTags === 'object' ? value.visualTags : {}
  return {
    originalDescription: String(value.originalDescription || value.summary || '').trim(),
    businessRelation: String(value.businessRelation || '').trim(),
    themeTags: stringList(value.themeTags),
    sceneTags: stringList(value.sceneTags),
    subjectTags: stringList(value.subjectTags),
    actionTags: stringList(value.actionTags),
    visualTags: {
      orientation: ['landscape', 'portrait', 'square'].includes(visual.orientation) ? visual.orientation : 'landscape',
      shotScale: String(visual.shotScale || '').trim(),
      subjectPosition: String(visual.subjectPosition || 'center').trim(),
      dominantColors: stringList(visual.dominantColors, 6),
      quality: ['high', 'medium', 'low'].includes(visual.quality) ? visual.quality : 'medium',
      textSafeArea: ['top', 'bottom', 'left', 'right', 'none'].includes(visual.textSafeArea) ? visual.textSafeArea : 'none',
    },
  }
}

function defaultLayout(count) {
  return count === 1 ? 'single-full' : count === 2 ? 'hero-two' : count === 3 ? 'hero-three' : 'grid-four'
}

function sanitizeRealPosterPlan(value, draft, photos) {
  const validIds = new Set(photos.filter((item) => item.enabled !== false && item.taggingStatus === 'ready').map((item) => item.id))
  if (!validIds.size) throw new Error('没有已完成分析的业务实拍图片')
  const rawPages = Array.isArray(value?.pages) ? value.pages.slice(0, 6) : []
  if (!rawPages.length) throw new Error('没有找到能由实拍素材支持的宣传主题')
  const used = new Set()
  const pages = []
  for (const raw of rawPages) {
    const ids = [...new Set(stringList(raw.sourcePhotoIds, 4).filter((id) => validIds.has(id) && !used.has(id)))].slice(0, 4)
    if (!ids.length) continue
    ids.forEach((id) => used.add(id))
    const count = ids.length
    const allowedLayouts = LAYOUTS_BY_COUNT[count]
    const layoutTemplateId = allowedLayouts.includes(raw.layoutTemplateId) ? raw.layoutTemplateId : defaultLayout(count)
    const index = pages.length
    const role = index === 0 ? 'cover' : 'content'
    pages.push({
      id: `REAL-PAGE-${String(index + 1).padStart(2, '0')}`,
      role,
      label: role === 'cover' ? '封面' : `内容页 ${index}`,
      purpose: String(raw.purpose || raw.groupReason || '').trim(),
      promotionTheme: String(raw.promotionTheme || raw.title || '').trim(),
      title: String(raw.title || (index === 0 ? draft.title : raw.promotionTheme) || '').trim().slice(0, 24),
      subtitle: String(raw.subtitle || '').trim().slice(0, 36),
      sourcePhotoIds: ids,
      groupReason: String(raw.groupReason || '').trim(),
      evidenceQuotes: stringList(raw.evidenceQuotes, 4),
      layoutTemplateId,
      textPosition: ['top', 'bottom'].includes(raw.textPosition) ? raw.textPosition : 'bottom',
      accentColor: String(raw.accentColor || '#ffd43b').trim(),
      referenceImageIds: [],
    })
  }
  if (!pages.length) throw new Error('分组结果没有包含有效的实拍图片')
  return {
    version: 1,
    concept: String(value.concept || '围绕已确认文案组织业务实拍素材').trim(),
    visualContinuity: String(value.visualContinuity || '统一使用醒目粗体标题、紧凑留白和主题色标签').trim(),
    pages,
  }
}

module.exports = { LAYOUTS_BY_COUNT, sanitizeRealPhotoTags, sanitizeRealPosterPlan }
