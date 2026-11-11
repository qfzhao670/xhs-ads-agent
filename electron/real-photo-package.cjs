const crypto = require('node:crypto')
const path = require('node:path')
const AdmZip = require('adm-zip')

const PACKAGE_FORMAT = 'xhs-real-photo-library'
const PACKAGE_VERSION = 1
const MANIFEST_FILE = 'manifest.json'
const MAX_PACKAGE_ITEMS = 100
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function imageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function normalizedExtension(value) {
  const input = String(value || '').toLowerCase()
  const extension = /^\.[a-z0-9]+$/.test(input) ? input : path.extname(input)
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`实拍素材包包含不支持的图片格式：${extension || '未知格式'}`)
  return extension
}

function safeImageEntry(value) {
  const entry = String(value || '').replace(/\\/g, '/')
  if (!entry.startsWith('images/') || entry.startsWith('/') || entry.includes('../') || entry.split('/').some((part) => !part || part === '..')) {
    throw new Error('实拍素材包包含无效的图片路径')
  }
  normalizedExtension(entry)
  return entry
}

function createRealPhotoPackage(entries, exportedAt = new Date().toISOString()) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('业务实拍图库为空，无法导出')
  if (entries.length > MAX_PACKAGE_ITEMS) throw new Error(`单个实拍素材包最多包含 ${MAX_PACKAGE_ITEMS} 张图片`)

  const archive = new AdmZip()
  const items = entries.map(({ photo = {}, buffer, extension }, index) => {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error(`${photo.originalName || photo.id || '图片'} 是空文件`)
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`${photo.originalName || photo.id || '图片'} 超过 10MB`)
    const normalized = normalizedExtension(extension || photo.originalName || photo.relativePath)
    const file = `images/${String(index + 1).padStart(4, '0')}${normalized}`
    const sha256 = imageHash(buffer)
    archive.addFile(file, buffer)
    return {
      sourceId: String(photo.id || ''),
      file,
      sha256,
      originalName: path.basename(String(photo.originalName || `${photo.id || `图片-${index + 1}`}${normalized}`)),
      width: Number(photo.width) || 0,
      height: Number(photo.height) || 0,
      enabled: photo.enabled !== false,
      taggingStatus: photo.taggingStatus === 'ready' ? 'ready' : photo.taggingStatus === 'failed' ? 'failed' : 'pending',
      taggingError: String(photo.taggingError || ''),
      tags: photo.tags && typeof photo.tags === 'object' ? photo.tags : {},
      createdAt: String(photo.createdAt || ''),
      updatedAt: String(photo.updatedAt || ''),
    }
  })
  const manifest = { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, exportedAt, items }
  archive.addFile(MANIFEST_FILE, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'))
  return archive.toBuffer()
}

function readRealPhotoPackage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('所选实拍素材包为空')
  let archive
  try { archive = new AdmZip(buffer) } catch { throw new Error('无法读取实拍素材包，请确认文件未损坏') }

  const manifestEntry = archive.getEntry(MANIFEST_FILE)
  if (!manifestEntry || manifestEntry.isDirectory) throw new Error('这不是有效的业务实拍素材包：缺少 manifest.json')
  if (Number(manifestEntry.header?.size) > MAX_MANIFEST_BYTES) throw new Error('实拍素材包清单过大')

  let manifest
  try { manifest = JSON.parse(manifestEntry.getData().toString('utf8')) } catch { throw new Error('实拍素材包清单不是有效的 JSON') }
  if (manifest?.format !== PACKAGE_FORMAT || manifest?.version !== PACKAGE_VERSION) throw new Error('实拍素材包格式或版本不受支持')
  if (!Array.isArray(manifest.items) || !manifest.items.length) throw new Error('实拍素材包中没有图片')
  if (manifest.items.length > MAX_PACKAGE_ITEMS) throw new Error(`单个实拍素材包最多导入 ${MAX_PACKAGE_ITEMS} 张图片`)

  const usedFiles = new Set()
  const entries = manifest.items.map((photo) => {
    const file = safeImageEntry(photo?.file)
    if (usedFiles.has(file)) throw new Error('实拍素材包清单包含重复的图片路径')
    usedFiles.add(file)
    const imageEntry = archive.getEntry(file)
    if (!imageEntry || imageEntry.isDirectory) throw new Error(`实拍素材包缺少图片：${file}`)
    if (Number(imageEntry.header?.size) > MAX_IMAGE_BYTES) throw new Error(`${path.basename(file)} 超过 10MB`)
    const image = imageEntry.getData()
    if (!image.length) throw new Error(`${path.basename(file)} 是空文件`)
    if (image.length > MAX_IMAGE_BYTES) throw new Error(`${path.basename(file)} 超过 10MB`)
    const sha256 = imageHash(image)
    if (photo.sha256 && String(photo.sha256).toLowerCase() !== sha256) throw new Error(`${path.basename(file)} 的校验值不匹配，实拍素材包可能已损坏`)
    return { photo, buffer: image, extension: normalizedExtension(file), sha256 }
  })
  return { manifest, entries }
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_PACKAGE_ITEMS,
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  createRealPhotoPackage,
  imageHash,
  readRealPhotoPackage,
}
