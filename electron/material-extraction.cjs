const path = require('node:path')

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const MAX_FILE_COUNT = 20

const imageMimeTypes = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const extractionPrompt = `请把所提供的 PDF 或图片忠实转写成一份 Markdown 文档。

要求：
1. 只输出 Markdown 正文，不要解释过程，不要使用包裹全文的代码块。
2. 保留原文信息和阅读顺序，不要摘要、改写、补充或推断原文没有的内容。
3. 尽量还原标题层级、段落、列表、表格、行程、价格、日期、联系方式和备注；表格请转换为 Markdown 表格。
4. 多页 PDF 按原页序连续整理；多张图片按输入顺序整理，必要时用简短标题分隔不同图片。
5. 装饰性图片可以忽略；图片中承载信息的文字必须提取。
6. 无法辨认的局部请标记为“[无法辨认]”，不要猜测。`

function materialFileKind(fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase()
  if (extension === '.pdf') return { kind: 'pdf', mime: 'application/pdf' }
  if (imageMimeTypes[extension]) return { kind: 'image', mime: imageMimeTypes[extension] }
  return null
}

function validateMaterialFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('请选择 PDF 或图片文件')
  if (files.length > MAX_FILE_COUNT) throw new Error(`一次最多选择 ${MAX_FILE_COUNT} 个文件`)
  let totalBytes = 0
  for (const file of files) {
    const type = materialFileKind(file.name || file.fileName)
    if (!type) throw new Error(`不支持的文件格式：${file.name || file.fileName || '未知文件'}`)
    const size = Number(file.size ?? file.byteLength ?? file.data?.length ?? 0)
    if (!Number.isFinite(size) || size <= 0) throw new Error(`文件为空：${file.name || file.fileName}`)
    if (size > MAX_FILE_BYTES) throw new Error(`文件超过 50MB：${file.name || file.fileName}`)
    totalBytes += size
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('所选文件合计超过 50MB，请分批提取')
}

function buildMaterialExtractionMessages(files) {
  validateMaterialFiles(files)
  const content = [{ type: 'text', text: extractionPrompt }]
  for (const file of files) {
    const fileName = String(file.name || file.fileName || '')
    const type = materialFileKind(fileName)
    const encoded = Buffer.isBuffer(file.data) ? file.data.toString('base64') : String(file.base64 || '')
    if (!encoded) throw new Error(`无法读取文件内容：${fileName}`)
    const dataUrl = `data:${type.mime};base64,${encoded}`
    if (type.kind === 'pdf') {
      content.push({ type: 'file', file: { filename: path.basename(fileName), file_data: dataUrl } })
    } else {
      content.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } })
    }
  }
  return [
    { role: 'system', content: '你是严谨的文档 OCR 转写助手。不得总结、杜撰或遗漏可辨认的信息。' },
    { role: 'user', content },
  ]
}

function normalizeExtractedMarkdown(value) {
  let markdown = String(value || '').trim()
  const fenced = markdown.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  if (fenced) markdown = fenced[1].trim()
  if (!markdown) throw new Error('视觉模型没有返回可读取的 Markdown 内容')
  return `${markdown}\n`
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  buildMaterialExtractionMessages,
  materialFileKind,
  normalizeExtractedMarkdown,
  validateMaterialFiles,
}
