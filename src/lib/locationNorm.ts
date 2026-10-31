/**
 * Location-text normalization (generic rule table; no show data). Merges naming variants of one place:
 *   owner prefixes  : a character name / baseName from the pack, "<surname>家", "<name>住处"
 *   building / area : 别墅 / 公寓 / 宅 / 老城区 / 旧城区 / 新城区 / 城郊 / 郊区
 *   institution     : 市一院 / 区二医院 / 第三人民医院 … + room class 单人 / 双人 / 三人 / VIP / 高级
 *   floor           : 二楼 / 3楼 / 一层
 *   state qualifier : 现实 / 梦中 / 梦里 / 回忆
 *   access suffix   : 入口 / 门口 (the place itself)
 *   label suffix    : ·日 / ·夜 / (…) / （…）
 * A rule only applies when ≥2 characters remain, so a bare noun is never emptied.
 */
export interface LocationNamer { names: string[]; surnames: string[] }

const AREA = /^(?:老城区|旧城区|新城区|城郊|郊区|市郊)/
const BUILDING = /^(?:别墅|公寓|宅邸|老宅|宅)/
// needs a district or number (市一院 / 第三人民医院); a bare 医院 prefix is a different place (its corridor ≠ any corridor)
const INSTITUTION = /^(?:[市区县省](?:第?[一二三四五六七八九十\d]+)?|第?[一二三四五六七八九十\d]+)(?:人民)?(?:医院|院)/
const ROOM_CLASS = /^(?:单人|双人|三人|VIP|高级|普通)/
const FLOOR = /^(?:[一二三四五六七八九十\d]+[楼层])/
const STATE = /^(?:现实|梦中|梦里|回忆中?)/
const ACCESS = /(?:入口|门口)$/
const OWNER_SUFFIX = /^(?:住处|家里|家中|家)/

export function locationNamer(chars: { name?: string; baseName?: string }[] = []): LocationNamer {
  const names = new Set<string>()
  for (const c of chars) for (const n of [c.baseName, c.name?.replace(/[（(][^）)]*[）)]/g, '')]) if (n && n.trim().length >= 2) names.add(n.trim())
  const surnames = new Set([...names].filter((n) => n.length >= 2 && n.length <= 3).map((n) => n[0]))
  return { names: [...names].sort((a, b) => b.length - a.length), surnames: [...surnames] }
}

export function normalizeLocation(text: string | undefined | null, namer: LocationNamer = { names: [], surnames: [] }): string {
  let s = (text || '').replace(/[（(][^）)]*[）)]/g, '').split(/[·・]/)[0].replace(/\s+/g, '')
  const strip = (re: RegExp | string) => {
    const r = typeof re === 'string' ? (s.startsWith(re) ? re : '') : (s.match(re) || [''])[0]
    if (r && s.length - r.length >= 2) {
      s = s.slice(r.length)
      return true
    }
    return false
  }
  for (let guard = 0; guard < 8; guard++) {
    let hit = false
    for (const n of namer.names) if (strip(n)) hit = true
    for (const sn of namer.surnames) if (strip(`${sn}家`)) hit = true
    hit = strip(OWNER_SUFFIX) || hit
    hit = strip(STATE) || hit
    hit = strip(AREA) || hit
    hit = strip(BUILDING) || hit
    hit = strip(INSTITUTION) || hit
    hit = strip(ROOM_CLASS) || hit
    hit = strip(FLOOR) || hit
    if (!hit) break
  }
  const a = s.match(ACCESS)
  if (a && s.length - a[0].length >= 2) s = s.slice(0, -a[0].length)
  return s
}
