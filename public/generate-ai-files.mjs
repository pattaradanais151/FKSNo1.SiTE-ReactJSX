// สร้าง llms.txt และ .well-known/ai-catalog.json จากเทมเพลตใน scripts/ai-files/
// โดยใส่โดเมนจริงของเว็บให้อัตโนมัติ
//
// ใช้งาน:
//   - อัตโนมัติหลัง `npm run build` (ผ่าน script "postbuild") เขียนลง dist/
//   - ด้วยมือ: node scripts/generate-ai-files.mjs [--out <โฟลเดอร์>]   (ค่าเริ่มต้น: dist)
//
// โดเมนอ่านจาก (ตามลำดับ): SITE_URL > VITE_SITE_URL > CF_PAGES_URL (Cloudflare Pages ใส่ให้เอง)
// แนะนำให้ตั้ง SITE_URL เป็นโดเมนจริง เช่น https://admin.example.com ใน Cloudflare Pages
// (CF_PAGES_URL เป็นลิงก์เฉพาะของการ Deploy ไม่ใช่โดเมนหลัก)

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const templatesDir = path.join(here, 'ai-files')

function readOutDir() {
  const index = process.argv.indexOf('--out')
  if (index !== -1 && process.argv[index + 1]) return path.resolve(process.argv[index + 1])
  return path.resolve(here, '..', 'dist')
}

function resolveSiteUrl() {
  const raw = process.env.SITE_URL || process.env.VITE_SITE_URL || process.env.CF_PAGES_URL || ''
  if (!raw.trim()) {
    console.warn('[ai-files] ไม่พบ SITE_URL จึงใช้ http://localhost:5173 (ตั้ง SITE_URL เป็นโดเมนจริงก่อน Deploy)')
    return new URL('http://console-fksno1.pages.dev/')
  }
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`SITE_URL ไม่ถูกต้อง: "${raw}" (ต้องขึ้นต้นด้วย https://)`)
  }
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !isLocal) {
    throw new Error(`SITE_URL ต้องเป็น https:// (ได้รับ "${raw}")`)
  }
  return url
}

function fill(template, values) {
  return template.replaceAll('{{SITE_URL}}', values.siteUrl).replaceAll('{{HOST}}', values.host)
}

function validateCatalog(text) {
  const catalog = JSON.parse(text)
  const problems = []
  if (typeof catalog.specVersion !== 'string') problems.push('specVersion')
  if (!catalog.host?.displayName || !catalog.host?.identifier) problems.push('host.displayName/host.identifier')
  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) problems.push('entries')
  for (const [i, entry] of (catalog.entries ?? []).entries()) {
    for (const key of ['identifier', 'displayName', 'type', 'url', 'description']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) problems.push(`entries[${i}].${key}`)
    }
    if (typeof entry.url === 'string' && !/^https?:\/\//.test(entry.url)) problems.push(`entries[${i}].url (ต้องเป็น URL เต็ม)`)
    if (typeof entry.identifier === 'string' && !entry.identifier.startsWith('urn:ai:')) problems.push(`entries[${i}].identifier (ต้องขึ้นต้นด้วย urn:ai:)`)
  }
  if (problems.length) throw new Error(`ai-catalog.json ไม่ครบหรือไม่ถูกต้อง: ${problems.join(', ')}`)
  return catalog
}

async function main() {
  const outDir = readOutDir()
  const site = resolveSiteUrl()
  const values = { siteUrl: site.origin, host: site.hostname }

  const llms = fill(await readFile(path.join(templatesDir, 'llms.txt'), 'utf8'), values)
  const catalogText = fill(await readFile(path.join(templatesDir, 'ai-catalog.json'), 'utf8'), values)
  const catalog = validateCatalog(catalogText)

  await mkdir(path.join(outDir, '.well-known'), { recursive: true })
  await writeFile(path.join(outDir, 'llms.txt'), llms, 'utf8')
  await writeFile(path.join(outDir, '.well-known', 'ai-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')

  console.log(`[ai-files] สร้าง llms.txt และ .well-known/ai-catalog.json ใน ${outDir} (โดเมน: ${values.siteUrl})`)
}

main().catch((error) => {
  console.error(`[ai-files] ${error.message}`)
  process.exit(1)
})
