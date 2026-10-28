const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const {
  assetMarkdownTables,
  createAssetExportXlsx,
  createTemplateXlsx,
  normalizeAsset,
  readXlsxRows,
  rowsToAssets,
} = require('./asset-utils.cjs')

test('generated templates contain the required headers', () => {
  const keywordRows = readXlsxRows(createTemplateXlsx('keywords'))
  const ruleRows = readXlsxRows(createTemplateXlsx('rules'))
  const referenceRows = readXlsxRows(createTemplateXlsx('references'))
  assert.deepEqual(keywordRows[0], ['序号', '分类', '核心关键词/词根', '词性标签', '痛点/意图标签', '建议用法(槽位)'])
  assert.deepEqual(ruleRows[0], ['序号', '禁用词/敏感表述', '风险类型', '判定依据', '处理方式', '替代写法'])
  assert.deepEqual(referenceRows[0], ['序号', '标题', '正文', '话题标签'])
})

test('batch rows map optional fields and reject missing required values', () => {
  const records = rowsToAssets('keywords', [
    ['序号', '分类', '核心关键词/词根', '词性标签', '痛点/意图标签', '建议用法(槽位)'],
    ['1', '地域人群', '佛山家长', '核心词', '精准人群', '{人群}'],
  ])
  assert.deepEqual(records, [{ category: '地域人群', root: '佛山家长', partOfSpeech: '核心词', intentTag: '精准人群', suggestedUse: '{人群}', enabled: true }])
  assert.throws(() => rowsToAssets('rules', [
    ['序号', '禁用词/敏感表述', '风险类型'],
    ['1', '', '绝对化表述'],
  ]), /第 2 行的必填项“禁用词\/敏感表述”为空/)
})

test('reference rows import hashtags and require both title and body', () => {
  const records = rowsToAssets('references', [
    ['序号', '标题', '正文', '话题标签'],
    ['1', '参考标题', '参考正文', '#亲子研学 佛山周末'],
  ])
  assert.deepEqual(records, [{ title: '参考标题', body: '参考正文', hashtags: ['亲子研学', '佛山周末'], enabled: true }])
  assert.throws(() => rowsToAssets('references', [
    ['序号', '标题', '正文', '话题标签'],
    ['1', '只有标题', '', ''],
  ]), /必填项“正文”为空/)
})

test('asset exports include status, stable ids, and complete content', () => {
  const rows = readXlsxRows(createAssetExportXlsx('references', [
    { id: 'REF-0001', title: '标题', body: '第一行\n第二行', hashtags: ['标签一'], enabled: false },
  ]))
  assert.deepEqual(rows[0], ['生效', '编号', '标题', '正文', '话题标签'])
  assert.deepEqual(rows[1], ['否', 'REF-0001', '标题', '第一行\n第二行', '#标签一'])
  assert.equal(rowsToAssets('references', rows)[0].enabled, false)
})

test('legacy records normalize without losing their stable ids', () => {
  assert.equal(normalizeAsset('keywords', { id: 'KW-0001', value: '旧关键词' }).root, '旧关键词')
  assert.equal(normalizeAsset('rules', { id: 'RULE-0001', content: '旧准则' }).prohibited, '旧准则')
})

test('prompt assets are Markdown tables with escaped content', () => {
  const tables = assetMarkdownTables({
    keywords: [{ id: 'KW-0001', root: 'A|B', suggestedUse: '第一行\n第二行' }],
    references: [{ id: 'REF-0001', title: '标题', body: '正文', hashtags: ['标签一', '标签二'] }],
    rules: [],
  })
  assert.match(tables.keywords, /A\\\|B/)
  assert.match(tables.keywords, /第一行<br>第二行/)
  assert.match(tables.references, /标签一、标签二/)
  assert.match(tables.rules, /\| （暂无记录） \|/)
})

test('disabled assets are excluded from prompt tables', () => {
  const tables = assetMarkdownTables({
    keywords: [{ id: 'KW-0001', root: '生效词', enabled: true }, { id: 'KW-0002', root: '停用词', enabled: false }],
    references: [{ id: 'REF-0001', title: '生效参考', body: '正文', enabled: true }, { id: 'REF-0002', title: '停用参考', body: '正文', enabled: false }],
    rules: [{ id: 'RULE-0001', prohibited: '生效准则', enabled: true }, { id: 'RULE-0002', prohibited: '停用准则', enabled: false }],
  })
  assert.match(tables.keywords, /生效词/)
  assert.doesNotMatch(tables.keywords, /停用词/)
  assert.doesNotMatch(tables.references, /停用参考/)
  assert.doesNotMatch(tables.rules, /停用准则/)
})

for (const fixture of [
  ['keywords', '/Users/zhaoqifan/Desktop/关键词库-模板.xlsx', 63],
  ['rules', '/Users/zhaoqifan/Desktop/合规准则-模板.xlsx', 15],
]) {
  const [kind, file, expectedCount] = fixture
  test(`provided ${kind} template imports`, { skip: !fs.existsSync(file) }, () => {
    const records = rowsToAssets(kind, readXlsxRows(fs.readFileSync(file)))
    assert.equal(records.length, expectedCount)
  })
}
