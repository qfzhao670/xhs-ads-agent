const test = require('node:test')
const assert = require('node:assert/strict')
const { sanitizeRealPhotoTags, sanitizeRealPosterPlan } = require('./real-photo-utils.cjs')

test('sanitizes real photo tags', () => {
  const tags = sanitizeRealPhotoTags({
    originalDescription: ' 校园鹤舞 ', themeTags: ['非遗', '', '校园'],
    visualTags: { orientation: 'portrait', quality: 'high', textSafeArea: 'top' },
  })
  assert.equal(tags.originalDescription, '校园鹤舞')
  assert.deepEqual(tags.themeTags, ['非遗', '校园'])
  assert.equal(tags.visualTags.textSafeArea, 'top')
})

test('keeps one to four valid photos and prevents reuse', () => {
  const photos = ['REALIMG-0001', 'REALIMG-0002', 'REALIMG-0003'].map((id) => ({ id, enabled: true, taggingStatus: 'ready' }))
  const plan = sanitizeRealPosterPlan({ pages: [
    { title: '校园里的非遗课', sourcePhotoIds: ['REALIMG-0001', 'REALIMG-0002'], layoutTemplateId: 'hero-two' },
    { title: '更多现场', sourcePhotoIds: ['REALIMG-0002', 'REALIMG-0003'] },
  ] }, { title: '测试文案' }, photos)
  assert.deepEqual(plan.pages[0].sourcePhotoIds, ['REALIMG-0001', 'REALIMG-0002'])
  assert.deepEqual(plan.pages[1].sourcePhotoIds, ['REALIMG-0003'])
  assert.equal(plan.pages[1].layoutTemplateId, 'single-full')
})

test('rejects plans without supported photos', () => {
  assert.throws(() => sanitizeRealPosterPlan({ pages: [] }, { title: '测试' }, [{ id: 'REALIMG-0001', enabled: true, taggingStatus: 'ready' }]), /没有找到/)
})
