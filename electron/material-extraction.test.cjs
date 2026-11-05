const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildMaterialExtractionMessages,
  materialFileKind,
  normalizeExtractedMarkdown,
  validateMaterialFiles,
} = require('./material-extraction.cjs')

test('recognizes only supported PDF and vision image formats', () => {
  assert.deepEqual(materialFileKind('行程.PDF'), { kind: 'pdf', mime: 'application/pdf' })
  assert.deepEqual(materialFileKind('海报.jpeg'), { kind: 'image', mime: 'image/jpeg' })
  assert.equal(materialFileKind('扫描件.tiff'), null)
})

test('builds PDF file and high-detail image content for Chat Completions', () => {
  const messages = buildMaterialExtractionMessages([
    { name: '研学.pdf', data: Buffer.from('pdf') },
    { name: '补充.png', data: Buffer.from('png') },
  ])
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].content[1].type, 'file')
  assert.equal(messages[1].content[1].file.filename, '研学.pdf')
  assert.match(messages[1].content[1].file.file_data, /^data:application\/pdf;base64,/)
  assert.deepEqual(messages[1].content[2].image_url.detail, 'high')
  assert.match(messages[1].content[2].image_url.url, /^data:image\/png;base64,/)
})

test('rejects empty, unsupported, and oversized selections', () => {
  assert.throws(() => validateMaterialFiles([]), /请选择/)
  assert.throws(() => validateMaterialFiles([{ name: '说明.docx', size: 10 }]), /不支持/)
  assert.throws(() => validateMaterialFiles([{ name: '空白.png', size: 0 }]), /文件为空/)
  assert.throws(() => validateMaterialFiles([{ name: '大文件.pdf', size: 51 * 1024 * 1024 }]), /超过 50MB/)
})

test('removes a single surrounding Markdown fence without changing content', () => {
  assert.equal(normalizeExtractedMarkdown('```markdown\n# 标题\n\n正文\n```'), '# 标题\n\n正文\n')
  assert.equal(normalizeExtractedMarkdown('# 标题'), '# 标题\n')
  assert.throws(() => normalizeExtractedMarkdown('   '), /没有返回/)
})
