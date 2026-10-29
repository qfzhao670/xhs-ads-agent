const test = require('node:test')
const assert = require('node:assert/strict')
const AdmZip = require('adm-zip')
const {
  PACKAGE_FORMAT,
  createImageReferencePackage,
  imageHash,
  readImageReferencePackage,
} = require('./image-reference-package.cjs')

const sampleReference = {
  id: 'XHSIMG-0007',
  originalName: '优秀封面.png',
  width: 1080,
  height: 1440,
  isCover: true,
  enabled: true,
  taggingStatus: 'ready',
  taggingError: '',
  tags: { summary: '明亮的户外封面', keywords: ['自然光', '亲子'] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

test('image reference packages preserve images and completed tags', () => {
  const image = Buffer.from('fake-png-image-for-package-test')
  const packageBuffer = createImageReferencePackage([{ reference: sampleReference, buffer: image, extension: '.png' }], '2026-10-29T00:00:00.000Z')
  const result = readImageReferencePackage(packageBuffer)

  assert.equal(result.manifest.format, PACKAGE_FORMAT)
  assert.equal(result.manifest.exportedAt, '2026-10-29T00:00:00.000Z')
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].reference.sourceId, sampleReference.id)
  assert.equal(result.entries[0].reference.taggingStatus, 'ready')
  assert.deepEqual(result.entries[0].reference.tags, sampleReference.tags)
  assert.deepEqual(result.entries[0].buffer, image)
  assert.equal(result.entries[0].sha256, imageHash(image))
})

test('image reference packages reject modified image contents', () => {
  const image = Buffer.from('original-image')
  const packageBuffer = createImageReferencePackage([{ reference: sampleReference, buffer: image, extension: '.png' }])
  const archive = new AdmZip(packageBuffer)
  archive.updateFile('images/0001.png', Buffer.from('modified-image'))

  assert.throws(() => readImageReferencePackage(archive.toBuffer()), /校验值不匹配/)
})

test('image reference packages reject unsafe manifest paths', () => {
  const archive = new AdmZip()
  archive.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: PACKAGE_FORMAT,
    version: 1,
    items: [{ file: '../outside.png' }],
  })))
  archive.addFile('outside.png', Buffer.from('image'))

  assert.throws(() => readImageReferencePackage(archive.toBuffer()), /无效的图片路径/)
})
