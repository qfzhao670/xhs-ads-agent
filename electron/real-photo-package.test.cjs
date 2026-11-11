const test = require('node:test')
const assert = require('node:assert/strict')
const AdmZip = require('adm-zip')
const {
  PACKAGE_FORMAT,
  createRealPhotoPackage,
  imageHash,
  readRealPhotoPackage,
} = require('./real-photo-package.cjs')

const samplePhoto = {
  id: 'REALIMG-0007',
  originalName: '现场活动.png',
  width: 1080,
  height: 1440,
  enabled: true,
  taggingStatus: 'ready',
  taggingError: '',
  tags: {
    originalDescription: '孩子在户外参加活动',
    businessRelation: '可用于展示活动现场',
    themeTags: ['亲子活动'],
    sceneTags: ['户外'],
    subjectTags: ['儿童'],
    actionTags: ['互动'],
    visualTags: { orientation: 'portrait', shotScale: '中景', subjectPosition: 'center', dominantColors: ['绿色'], quality: 'high', textSafeArea: 'top' },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

test('real photo packages preserve images and completed analysis tags', () => {
  const image = Buffer.from('fake-png-image-for-real-photo-package-test')
  const packageBuffer = createRealPhotoPackage([{ photo: samplePhoto, buffer: image, extension: '.png' }], '2026-11-11T00:00:00.000Z')
  const result = readRealPhotoPackage(packageBuffer)

  assert.equal(result.manifest.format, PACKAGE_FORMAT)
  assert.equal(result.manifest.exportedAt, '2026-11-11T00:00:00.000Z')
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].photo.sourceId, samplePhoto.id)
  assert.equal(result.entries[0].photo.taggingStatus, 'ready')
  assert.deepEqual(result.entries[0].photo.tags, samplePhoto.tags)
  assert.deepEqual(result.entries[0].buffer, image)
  assert.equal(result.entries[0].sha256, imageHash(image))
})

test('real photo packages reject modified image contents', () => {
  const packageBuffer = createRealPhotoPackage([{ photo: samplePhoto, buffer: Buffer.from('original-image'), extension: '.png' }])
  const archive = new AdmZip(packageBuffer)
  archive.updateFile('images/0001.png', Buffer.from('modified-image'))

  assert.throws(() => readRealPhotoPackage(archive.toBuffer()), /校验值不匹配/)
})

test('real photo packages reject image-reference packages', () => {
  const archive = new AdmZip()
  archive.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: 'xhs-image-reference-library',
    version: 1,
    items: [{ file: 'images/0001.png' }],
  })))
  archive.addFile('images/0001.png', Buffer.from('image'))

  assert.throws(() => readRealPhotoPackage(archive.toBuffer()), /格式或版本不受支持/)
})
