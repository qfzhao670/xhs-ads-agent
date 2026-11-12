const test = require('node:test')
const assert = require('node:assert/strict')
const { sanitizeRealPhotoTags, sanitizeRealPosterPlan } = require('./real-photo-utils.cjs')

test('sanitizes real photo tags', () => {
  const tags = sanitizeRealPhotoTags({
    originalDescription: ' 学生在操场合影 ', visibleText: ['校名', ''], themeTags: ['集体照', '', '校园'],
    businessRelation: '旧版本推断出的业务关系',
    visualTags: { orientation: 'portrait', quality: 'high', textSafeArea: 'top' },
  })
  assert.equal(tags.originalDescription, '学生在操场合影')
  assert.deepEqual(tags.visibleText, ['校名'])
  assert.deepEqual(tags.themeTags, ['集体照', '校园'])
  assert.equal(tags.businessContext, '')
  assert.equal(tags.businessRelation, '旧版本推断出的业务关系')
  assert.equal(tags.visualTags.textSafeArea, 'top')
})

test('keeps per-photo matches, drops conflicting photos, and prevents reuse', () => {
  const photos = ['REALIMG-0001', 'REALIMG-0002', 'REALIMG-0003'].map((id) => ({ id, enabled: true, taggingStatus: 'ready' }))
  const plan = sanitizeRealPosterPlan({ pages: [
    { title: '校园里的非遗课', photoMatches: [
      { photoId: 'REALIMG-0001', relevanceLevel: 'direct', evidenceQuotes: ['校园里的非遗课'], reason: '直接展示' },
      { photoId: 'REALIMG-0002', relevanceLevel: 'conflicting', evidenceQuotes: [], reason: '事实冲突' },
    ], layoutTemplateId: 'hero-two' },
    { title: '更多现场', photoMatches: [
      { photoId: 'REALIMG-0001', relevanceLevel: 'supporting', evidenceQuotes: ['孩子们近距离观察'] },
      { photoId: 'REALIMG-0003', relevanceLevel: 'contextual', evidenceQuotes: ['孩子们近距离观察'], reason: '活动氛围' },
    ] },
  ] }, { title: '校园里的非遗课', body: '孩子们近距离观察传统表演。' }, photos)
  assert.deepEqual(plan.pages[0].sourcePhotoIds, ['REALIMG-0001'])
  assert.deepEqual(plan.pages[1].sourcePhotoIds, ['REALIMG-0003'])
  assert.equal(plan.pages[1].photoMatches[0].relevanceLevel, 'contextual')
  assert.equal(plan.pages[1].needsReview, true)
  assert.equal(plan.pages[1].layoutTemplateId, 'single')
})

test('creates a visual-quality fallback when the model returns no pages', () => {
  const photos = [
    { id: 'REALIMG-0001', enabled: true, taggingStatus: 'ready', width: 800, height: 600, tags: { visualTags: { quality: 'low', textSafeArea: 'none' } } },
    { id: 'REALIMG-0002', enabled: true, taggingStatus: 'ready', width: 1600, height: 1200, tags: { visualTags: { quality: 'high', textSafeArea: 'top' } } },
  ]
  const plan = sanitizeRealPosterPlan({ pages: [] }, { title: '校园成长记录' }, photos)
  assert.deepEqual(plan.pages[0].sourcePhotoIds, ['REALIMG-0002'])
  assert.equal(plan.pages[0].photoMatches[0].relevanceLevel, 'fallback')
  assert.equal(plan.pages[0].needsReview, true)
})

test('downgrades an unsupported direct claim instead of dropping the photo', () => {
  const photos = [{ id: 'REALIMG-0001', enabled: true, taggingStatus: 'ready' }]
  const plan = sanitizeRealPosterPlan({ pages: [{
    title: '在史迹展陈中读懂家国',
    photoMatches: [{ photoId: 'REALIMG-0001', relevanceLevel: 'direct', evidenceQuotes: ['鹤舞非遗研学'] }],
  }] }, { title: '太阳能板下面还能长菜吗', body: '一起观察光伏板下的农田。' }, photos)
  assert.deepEqual(plan.pages[0].sourcePhotoIds, ['REALIMG-0001'])
  assert.equal(plan.pages[0].photoMatches[0].relevanceLevel, 'fallback')
  assert.equal(plan.pages[0].needsReview, true)
})

test('keeps a student group photo as contextual support', () => {
  const photos = [{ id: 'REALIMG-0001', enabled: true, taggingStatus: 'ready' }]
  const plan = sanitizeRealPosterPlan({ pages: [{
    title: '一起完成研学之旅',
    photoMatches: [{ photoId: 'REALIMG-0001', relevanceLevel: 'contextual', evidenceQuotes: ['同学们一起完成'], reason: '学生集体照表达共同参与' }],
  }] }, { title: '研学之旅', body: '同学们一起完成这次校园实践。' }, photos)
  assert.equal(plan.pages[0].photoMatches[0].relevanceLevel, 'contextual')
  assert.deepEqual(plan.pages[0].evidenceQuotes, ['同学们一起完成'])
})

test('creates a blank editable page when every photo is explicitly conflicting', () => {
  const photos = [{ id: 'REALIMG-0001', enabled: true, taggingStatus: 'ready' }]
  const plan = sanitizeRealPosterPlan({ pages: [{
    title: '测试',
    photoMatches: [{ photoId: 'REALIMG-0001', relevanceLevel: 'conflicting', reason: '画面事实冲突' }],
  }] }, { title: '测试文案' }, photos)
  assert.deepEqual(plan.pages[0].sourcePhotoIds, [])
  assert.equal(plan.pages[0].needsReview, true)
})
