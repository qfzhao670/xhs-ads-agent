const path = require('node:path')
const zlib = require('node:zlib')

const assetSchemas = {
  keywords: {
    headers: ['序号', '分类', '核心关键词/词根', '词性标签', '痛点/意图标签', '建议用法(槽位)'],
    requiredHeader: '核心关键词/词根',
    fields: {
      分类: 'category',
      '核心关键词/词根': 'root',
      词性标签: 'partOfSpeech',
      '痛点/意图标签': 'intentTag',
      '建议用法(槽位)': 'suggestedUse',
    },
  },
  rules: {
    headers: ['序号', '禁用词/敏感表述', '风险类型', '判定依据', '处理方式', '替代写法'],
    requiredHeader: '禁用词/敏感表述',
    fields: {
      '禁用词/敏感表述': 'prohibited',
      风险类型: 'riskType',
      判定依据: 'basis',
      处理方式: 'handling',
      替代写法: 'replacement',
    },
  },
}

function text(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function parseHashtags(value) {
  const values = Array.isArray(value) ? value : text(value).split(/[\s,，、]+/)
  return [...new Set(values.map((item) => text(item).replace(/^#+/, '')).filter(Boolean))]
}

function normalizeAsset(kind, value = {}) {
  const enabled = value.enabled !== false
  if (kind === 'keywords') {
    return {
      ...value,
      enabled,
      category: text(value.category),
      root: text(value.root || value.value),
      partOfSpeech: text(value.partOfSpeech),
      intentTag: text(value.intentTag),
      suggestedUse: text(value.suggestedUse),
    }
  }
  if (kind === 'rules') {
    return {
      ...value,
      enabled,
      prohibited: text(value.prohibited || value.content),
      riskType: text(value.riskType),
      basis: text(value.basis),
      handling: text(value.handling),
      replacement: text(value.replacement),
    }
  }
  if (kind === 'references') {
    return {
      ...value,
      enabled,
      title: text(value.title),
      body: text(value.body),
      hashtags: parseHashtags(value.hashtags),
    }
  }
  return value
}

function escapeMarkdownCell(value) {
  const normalized = Array.isArray(value) ? value.join('、') : value
  return text(normalized)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
}

function markdownTable(items, columns) {
  const header = `| ${columns.map(([label]) => escapeMarkdownCell(label)).join(' | ')} |`
  const divider = `| ${columns.map(() => '---').join(' | ')} |`
  const rows = items.map((item) => `| ${columns.map(([, key]) => escapeMarkdownCell(item[key])).join(' | ')} |`)
  if (!rows.length) rows.push(`| ${['（暂无记录）', ...columns.slice(1).map(() => '')].join(' | ')} |`)
  return [header, divider, ...rows].join('\n')
}

function assetMarkdownTables(project, references = project.references) {
  const enabled = (items) => items.filter((item) => item.enabled !== false)
  return {
    keywords: markdownTable(enabled(project.keywords).map((item) => normalizeAsset('keywords', item)), [
      ['编号', 'id'], ['分类', 'category'], ['核心关键词/词根', 'root'], ['词性标签', 'partOfSpeech'],
      ['痛点/意图标签', 'intentTag'], ['建议用法(槽位)', 'suggestedUse'],
    ]),
    references: markdownTable(enabled(references).map((item) => normalizeAsset('references', item)), [
      ['编号', 'id'], ['标题', 'title'], ['正文', 'body'], ['话题标签', 'hashtags'],
    ]),
    rules: markdownTable(enabled(project.rules).map((item) => normalizeAsset('rules', item)), [
      ['编号', 'id'], ['禁用词/敏感表述', 'prohibited'], ['风险类型', 'riskType'], ['判定依据', 'basis'],
      ['处理方式', 'handling'], ['替代写法', 'replacement'],
    ]),
  }
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
}

function attr(source, name) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))
  return match ? decodeXml(match[1]) : ''
}

function unzipEntries(buffer) {
  let end = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { end = offset; break }
  }
  if (end < 0) throw new Error('文件不是有效的 Excel 工作簿')
  const count = buffer.readUInt16LE(end + 10)
  let cursor = buffer.readUInt32LE(end + 16)
  const entries = new Map()
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Excel 文件目录损坏')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const fileNameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8')
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Excel 文件内容损坏')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    const data = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null
    if (!data) throw new Error('Excel 文件使用了暂不支持的压缩方式')
    entries.set(name.replace(/^\//, ''), data)
    cursor += 46 + fileNameLength + extraLength + commentLength
  }
  return entries
}

function collectText(xml) {
  return [...String(xml || '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('')
}

function firstWorksheetPath(entries) {
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8') || ''
  const relationships = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || ''
  const sheet = workbook.match(/<sheet\b([^>]*)\/?\s*>/)
  const relationshipId = sheet ? attr(sheet[1], 'r:id') : ''
  if (relationshipId) {
    for (const match of relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
      if (attr(match[1], 'Id') === relationshipId) {
        const target = attr(match[1], 'Target').replace(/^\//, '')
        return target.startsWith('xl/') ? path.posix.normalize(target) : path.posix.normalize(`xl/${target}`)
      }
    }
  }
  return 'xl/worksheets/sheet1.xml'
}

function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A'
  return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1
}

function readXlsxRows(buffer) {
  const entries = unzipEntries(buffer)
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || ''
  const sharedStrings = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => collectText(match[1]))
  const worksheet = entries.get(firstWorksheetPath(entries))?.toString('utf8')
  if (!worksheet) throw new Error('Excel 文件中没有可读取的工作表')
  const rows = []
  for (const rowMatch of worksheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attr(rowMatch[1], 'r')) || rows.length + 1
    const row = []
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const cellAttrs = cellMatch[1]
      const body = cellMatch[2]
      const type = attr(cellAttrs, 't')
      const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || ''
      let value = ''
      if (type === 's') value = sharedStrings[Number(raw)] || ''
      else if (type === 'inlineStr') value = collectText(body)
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
      else value = decodeXml(raw)
      row[columnIndex(attr(cellAttrs, 'r'))] = value
    }
    rows[rowNumber - 1] = row
  }
  return rows
}

function rowsToAssets(kind, rows) {
  const schema = assetSchemas[kind]
  if (!schema) throw new Error('该资料库不支持 Excel 批量导入')
  const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => text(cell)))
  if (headerRowIndex < 0) throw new Error('Excel 文件为空')
  const header = rows[headerRowIndex].map(text)
  const indexes = {}
  for (const [label, key] of Object.entries(schema.fields)) indexes[key] = header.indexOf(label)
  if (indexes[schema.fields[schema.requiredHeader]] < 0) throw new Error(`缺少必填列“${schema.requiredHeader}”`)
  const imported = []
  const invalidRows = []
  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || []
    if (!row.some((cell) => text(cell))) continue
    const item = {}
    for (const [label, key] of Object.entries(schema.fields)) {
      const column = indexes[key]
      item[key] = column >= 0 ? text(row[column]) : ''
    }
    const requiredKey = schema.fields[schema.requiredHeader]
    if (!item[requiredKey]) invalidRows.push(index + 1)
    else imported.push(normalizeAsset(kind, item))
  }
  if (invalidRows.length) {
    const shown = invalidRows.slice(0, 8).join('、')
    const suffix = invalidRows.length > 8 ? ` 等共 ${invalidRows.length} 行` : ' 行'
    throw new Error(`第 ${shown}${suffix}的“${schema.requiredHeader}”为空`)
  }
  if (!imported.length) throw new Error('没有找到可导入的数据行')
  return imported
}

let crcTable
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, number) => {
      let value = number
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      return value >>> 0
    })
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  }
}

function zipFiles(files) {
  const localParts = []
  const centralParts = []
  const stamp = dosDateTime()
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name)
    const source = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const compressed = zlib.deflateRawSync(source)
    const crc = crc32(source)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8); local.writeUInt16LE(stamp.time, 10); local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(source.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26); local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuffer, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(stamp.time, 12); central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(source.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + compressed.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, ...centralParts, end])
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function columnName(index) {
  let number = index + 1
  let result = ''
  while (number) { number -= 1; result = String.fromCharCode(65 + (number % 26)) + result; number = Math.floor(number / 26) }
  return result
}

function createTemplateXlsx(kind) {
  const schema = assetSchemas[kind]
  if (!schema) throw new Error('该资料库没有可下载的模板')
  const cells = schema.headers.map((header, index) => `<c r="${columnName(index)}1" t="inlineStr" s="1"><is><t>${xmlEscape(header)}</t></is></c>`).join('')
  const widths = schema.headers.map((_header, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 0 ? 10 : 24}" customWidth="1"/>`).join('')
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData><row r="1" ht="24" customHeight="1">${cells}</row></sheetData><autoFilter ref="A1:${columnName(schema.headers.length - 1)}1"/></worksheet>`,
  }
  return zipFiles(files)
}

module.exports = {
  assetSchemas,
  assetMarkdownTables,
  createTemplateXlsx,
  markdownTable,
  normalizeAsset,
  parseHashtags,
  readXlsxRows,
  rowsToAssets,
}
