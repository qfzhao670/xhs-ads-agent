const LAYOUTS_BY_COUNT = {
  1: ['single', 'single-full', 'single-caption'],
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
    visibleText: stringList(value.visibleText, 8),
    businessContext: String(value.businessContext || '').trim(),
    // Kept only so older project files and exported packages remain readable.
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
  return count === 1 ? 'single' : count === 2 ? 'hero-two' : count === 3 ? 'hero-three' : 'hero-four'
}

function comparableText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function draftText(draft = {}) {
  const hashtags = Array.isArray(draft.hashtags) ? draft.hashtags.join(' ') : draft.hashtags
  return comparableText([draft.title, draft.body, hashtags].filter(Boolean).join('\n'))
}

function validDraftEvidence(value, draft) {
  const text = draftText(draft)
  return stringList(value, 4).filter((quote) => {
    const comparableQuote = comparableText(quote)
    return comparableQuote.length >= 2 && text.includes(comparableQuote)
  })
}

const MATCH_LEVELS = ['direct', 'supporting', 'contextual', 'fallback', 'conflicting']

function normalizeMatchLevel(value) {
  const level = String(value || '').trim()
  if (MATCH_LEVELS.includes(level)) return level
  if (level === 'unrelated') return 'fallback'
  return 'fallback'
}

function visualScore(photo) {
  const visual = photo?.tags?.visualTags || {}
  const quality = visual.quality === 'high' ? 30 : visual.quality === 'low' ? 0 : 15
  const safeArea = visual.textSafeArea && visual.textSafeArea !== 'none' ? 8 : 0
  const pixels = Math.min(12, Math.round((Number(photo.width) * Number(photo.height)) / 1_000_000))
  return quality + safeArea + pixels
}

function fallbackPage(draft, photos, excludedIds = new Set()) {
  const photo = photos
    .filter((item) => item.enabled !== false && item.taggingStatus === 'ready' && !excludedIds.has(item.id))
    .sort((left, right) => visualScore(right) - visualScore(left))[0]
  const match = photo ? {
    photoId: photo.id,
    relevanceLevel: 'fallback',
    evidenceQuotes: [],
    reason: '当前没有更强的自动匹配，先使用画质和排版适用性较好的实拍图作为可编辑初稿。',
  } : null
  return {
    id: 'REAL-PAGE-01',
    role: 'cover',
    label: '封面',
    title: String(draft?.title || '实拍宣传图').trim(),
    promotionTheme: String(draft?.title || '实拍宣传图').trim(),
    purpose: '生成可编辑的实拍宣传图初稿',
    groupReason: match ? match.reason : '没有可自动使用的图片，请手动选择实拍素材。',
    photoMatches: match ? [match] : [],
    sourcePhotoIds: match ? [match.photoId] : [],
    relevanceLevel: 'fallback',
    relevanceReason: match?.reason || '等待用户手动选图',
    evidenceQuotes: [],
    layoutTemplateId: 'single',
    textPosition: 'bottom',
    accentColor: '#ffd43b',
    needsReview: true,
    referenceImageIds: [],
  }
}

function rawPhotoMatches(raw) {
  const matches = Array.isArray(raw.photoMatches) ? raw.photoMatches : Array.isArray(raw.matches) ? raw.matches : null
  if (matches) return matches
  return stringList(raw.sourcePhotoIds, 4).map((photoId) => ({
    photoId,
    relevanceLevel: raw.relevanceLevel,
    evidenceQuotes: raw.evidenceQuotes,
    reason: raw.relevanceReason || raw.groupReason,
  }))
}

function sanitizeRealPosterPlan(value, draft, photos) {
  const validIds = new Set(photos.filter((item) => item.enabled !== false && item.taggingStatus === 'ready').map((item) => item.id))
  if (!validIds.size) throw new Error('没有已完成分析的业务实拍图片')
  const rawPages = Array.isArray(value?.pages) ? value.pages.slice(0, 6) : []
  const used = new Set()
  const conflicting = new Set()
  for (const raw of rawPages) for (const candidate of rawPhotoMatches(raw)) {
    const photoId = String(candidate.photoId || candidate.id || '').trim()
    if (validIds.has(photoId) && normalizeMatchLevel(candidate.relevanceLevel || candidate.level) === 'conflicting') conflicting.add(photoId)
  }
  const pages = []
  for (const raw of rawPages) {
    const matches = []
    for (const candidate of rawPhotoMatches(raw)) {
      const photoId = String(candidate.photoId || candidate.id || '').trim()
      if (!validIds.has(photoId) || used.has(photoId) || conflicting.has(photoId)) continue
      let relevanceLevel = normalizeMatchLevel(candidate.relevanceLevel || candidate.level)
      if (relevanceLevel === 'conflicting') {
        continue
      }
      const evidenceQuotes = validDraftEvidence(candidate.evidenceQuotes || (candidate.evidenceQuote ? [candidate.evidenceQuote] : []), draft)
      if (['direct', 'supporting'].includes(relevanceLevel) && !evidenceQuotes.length) relevanceLevel = 'fallback'
      matches.push({
        photoId,
        relevanceLevel,
        evidenceQuotes,
        reason: String(candidate.reason || candidate.relevanceReason || '').trim(),
      })
      used.add(photoId)
      if (matches.length >= 4) break
    }
    const ids = matches.map((item) => item.photoId)
    if (!ids.length) continue
    const count = ids.length
    const allowedLayouts = LAYOUTS_BY_COUNT[count]
    const requestedLayout = count === 1 && ['single-full', 'single-caption'].includes(raw.layoutTemplateId) ? 'single' : raw.layoutTemplateId
    const layoutTemplateId = allowedLayouts.includes(requestedLayout) ? requestedLayout : defaultLayout(count)
    const index = pages.length
    const role = index === 0 ? 'cover' : 'content'
    const evidenceQuotes = [...new Set(matches.flatMap((item) => item.evidenceQuotes))].slice(0, 4)
    const needsReview = matches.some((item) => ['contextual', 'fallback'].includes(item.relevanceLevel))
    const relevanceLevel = needsReview ? (matches.some((item) => item.relevanceLevel === 'fallback') ? 'fallback' : 'contextual')
      : matches.some((item) => item.relevanceLevel === 'supporting') ? 'supporting' : 'direct'
    pages.push({
      id: `REAL-PAGE-${String(index + 1).padStart(2, '0')}`,
      role,
      label: role === 'cover' ? '封面' : `内容页 ${index}`,
      purpose: String(raw.purpose || raw.groupReason || '').trim(),
      promotionTheme: String(raw.promotionTheme || raw.title || '').trim(),
      title: String(raw.title || (index === 0 ? draft.title : raw.promotionTheme) || '').trim().slice(0, 24),
      subtitle: String(raw.subtitle || '').trim().slice(0, 36),
      sourcePhotoIds: ids,
      photoMatches: matches,
      groupReason: String(raw.groupReason || matches.map((item) => item.reason).filter(Boolean).join('；')).trim(),
      evidenceQuotes,
      relevanceLevel,
      relevanceReason: String(raw.relevanceReason || raw.groupReason || matches.map((item) => item.reason).filter(Boolean).join('；')).trim(),
      needsReview,
      layoutTemplateId,
      textPosition: ['top', 'bottom'].includes(raw.textPosition) ? raw.textPosition : 'bottom',
      accentColor: String(raw.accentColor || '#ffd43b').trim(),
      referenceImageIds: [],
    })
  }
  if (!pages.length) pages.push(fallbackPage(draft, photos, conflicting))
  return {
    version: 1,
    concept: String(value?.concept || '围绕已确认文案组织业务实拍素材').trim(),
    visualContinuity: String(value?.visualContinuity || '统一使用醒目粗体标题、紧凑留白和主题色标签').trim(),
    pages,
  }
}

module.exports = { LAYOUTS_BY_COUNT, sanitizeRealPhotoTags, sanitizeRealPosterPlan }
