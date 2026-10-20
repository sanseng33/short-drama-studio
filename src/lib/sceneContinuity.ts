/**
 * Deterministic scene continuity for video-pipeline@1 shots:
 *   sceneId / sceneLabel / carryFromPrev — enables last-frame→first-frame (FL2V) chaining
 *   within a stable physical place + coarse time band.
 *
 * Prefer post-processing over LLM: derive from visual/prompt/action (+ optional location tag).
 */
import type { VideoPipelineShot } from './videoExport'

/** Coarse time bands used in sceneId suffixes. */
export type TimeBand = 'night' | 'day' | 'dusk' | 'unknown'

export interface PlaceHit {
  /** English slug, e.g. villa_bedroom */
  key: string
  /** Short Chinese label without time, e.g. 江景别墅卧室 */
  labelZh: string
  /** Match weight (higher = more specific) */
  weight: number
}

export interface SceneFields {
  sceneId: string
  sceneLabel: string
  placeKey: string
  timeBand: TimeBand
}

export type ContinuityShot = Pick<
  VideoPipelineShot,
  'id' | 'episode' | 'prompt' | 'visual' | 'action' | 'timeOfDay' | 'characterIds' | 'overlayText' | 'mergedFrom'
> & {
  /** Optional LLM/storyboard short location tag */
  location?: string
  sceneId?: string
  sceneLabel?: string
  carryFromPrev?: boolean
  /** Internal: merge crossed distinct sceneIds */
  _scenesCrossed?: boolean
}

/** Place patterns: longer / more specific first. */
const PLACE_RULES: { key: string; labelZh: string; re: RegExp; weight: number }[] = [
  {
    key: 'villa_bedroom',
    labelZh: '江景别墅卧室',
    re: /(江景)?别墅[^。；\n]{0,12}(卧室|二楼|床|床头|枕头|被子|地毯)|别墅卧室|卧室[^。；\n]{0,8}(落地窗|江景|别墅)/,
    weight: 40,
  },
  {
    key: 'villa_window',
    labelZh: '别墅落地窗',
    re: /(江景)?别墅[^。；\n]{0,10}(落地窗|窗前|窗玻璃|开窗)|落地窗[^。；\n]{0,8}(别墅|江景|窗台)|别墅窗前|别墅落地窗/,
    weight: 35,
  },
  { key: 'villa', labelZh: '江景别墅', re: /(江景)?别墅|智能窗帘|衣帽间|嵌入式灯带/, weight: 20 },
  // bedroom anchors without the word 别墅 (rich interior)
  {
    key: 'villa_bedroom',
    labelZh: '江景别墅卧室',
    re: /(穿衣镜|床头柜|枕头|枕上|被子|床沿|冰袋).{0,40}(落地窗|江景|哑光|床头)|落地窗.{0,30}(穿衣镜|床头|枕头|卧室)|床头柜/,
    weight: 28,
  },
  {
    key: 'alley_window',
    labelZh: '旧楼窗',
    re: /(旧楼|老楼|对面楼)[^。；\n]{0,12}(窗|铁栏|栏杆)|铁栏杆窗|旧楼窗|对窗旧楼|旧楼窗前|晾衣绳[^。；\n]{0,8}(窗|栏|旧)/,
    weight: 40,
  },
  // bare 窄巷 alone is weak — only used when no villa/classroom header won
  { key: 'alley', labelZh: '窄巷', re: /旧楼|老楼|铁栏杆/, weight: 12 },
  { key: 'classroom', labelZh: '教室', re: /教室|课桌|讲台|同桌|后排座位|靠窗座位|粉笔|黑板/, weight: 35 },
  {
    key: 'school_corridor',
    labelZh: '教学楼走廊',
    re: /(教学楼)?走廊|水磨石|公告栏|储物柜|班级牌|教室门/,
    weight: 30,
  },
  { key: 'school_gate', labelZh: '校门口', re: /校门口|校门/, weight: 30 },
  { key: 'milk_tea_shop', labelZh: '奶茶店', re: /奶茶店|点单台|封口机|扫码盒/, weight: 35 },
  { key: 'schoolyard', labelZh: '楼下花坛', re: /花坛|操场|球场|楼下/, weight: 25 },
  { key: 'dorm', labelZh: '宿舍', re: /宿舍|寝室/, weight: 30 },
  { key: 'cafeteria', labelZh: '食堂', re: /食堂|小卖部/, weight: 30 },
  { key: 'library', labelZh: '图书馆', re: /图书馆/, weight: 30 },
  { key: 'office', labelZh: '办公室', re: /办公室|教导处/, weight: 25 },
  { key: 'bus', labelZh: '公交车厢', re: /公交|地铁车厢|车厢/, weight: 25 },
  { key: 'street', labelZh: '街边', re: /马路|街道|街边|路口/, weight: 15 },
  { key: 'park', labelZh: '公园', re: /公园|江边/, weight: 20 },
  { key: 'hospital', labelZh: '医院', re: /医院|病房|诊室/, weight: 25 },
  { key: 'mall', labelZh: '商场', re: /商场|超市|便利店/, weight: 20 },
  { key: 'elevator', labelZh: '电梯', re: /电梯|大堂/, weight: 20 },
  { key: 'bathroom', labelZh: '卫生间', re: /浴室|卫生间|洗手间/, weight: 25 },
  { key: 'kitchen', labelZh: '厨房', re: /厨房/, weight: 25 },
  { key: 'living_room', labelZh: '客厅', re: /客厅/, weight: 25 },
  { key: 'balcony', labelZh: '阳台', re: /阳台|天台|楼顶/, weight: 25 },
]

const TIME_ZH: Record<TimeBand, string> = {
  night: '夜',
  day: '日',
  dusk: '黄昏',
  unknown: '',
}

/** Map storyboard timeOfDay (and text cues) to a coarse band. */
export function timeBandOf(timeOfDay?: string | null, ...extra: string[]): TimeBand {
  const blob = [timeOfDay || '', ...extra].join(' ')
  const t = (timeOfDay || '').trim()
  if (/黄昏|傍晚|日落|夕阳/.test(t)) return 'dusk'
  if (/^(夜|晚上|深夜|夜里|半夜|夜晚)/.test(t) || (/(夜|晚上|深夜|夜里|夜晚)/.test(t) && !/昨夜|隔夜/.test(t)))
    return 'night'
  if (/清晨|早上|早晨|上午|中午|白天|日间|下午|午后|[0-9一二三四五六七八九十]+点/.test(t)) return 'day'
  if (/黄昏|傍晚/.test(blob)) return 'dusk'
  if (/(夜戏|夜景|深夜|夜里|夜晚|晚上)/.test(blob) && !/(清晨|早上|白天|早晨)/.test(blob)) return 'night'
  if (/(清晨|早上|早晨|白天|上午|中午|下午)/.test(blob)) return 'day'
  return 'unknown'
}

/** Scene header of the prompt (before 主体 / first clause), strongest structured place cue. */
export function promptHead(prompt: string): string {
  const p = (prompt || '').replace(/竖屏9:16[，,。]?/g, '')
  // drop common bridge boilerplate so 窄巷/对窗 composition does not steal place
  const cleaned = p
    .replace(/构图[：:][^。\n]*/g, '')
    .replace(/两处隔窄巷相望的对窗空间[^。\n]*/g, '')
    .replace(/越窗长焦[^。\n]*/g, '')
  const k = cleaned.search(/主体\s*[：:]/)
  return k >= 0 && k <= 56 ? cleaned.slice(0, k) : cleaned.split(/[。\n]/)[0].slice(0, 56)
}

/** Text blob used for place classification (location tag wins when present). */
export function placeBlob(s: ContinuityShot): string {
  const loc = (s.location || '').trim()
  const head = promptHead(s.prompt || '')
  // first 1–2 visual clauses (avoid late reverse-shot flipping place, but catch 床头柜/落地窗)
  const visParts = (s.visual || '').split(/[；;]/).filter(Boolean)
  const vis = visParts.slice(0, 2).join('；').slice(0, 140)
  return [loc, head, vis, s.action || ''].filter(Boolean).join('｜')
}

/** Prefer header/location hits over body when both villa and alley match. */
export function classifyPlacePreferHeader(s: ContinuityShot): PlaceHit | null {
  const loc = (s.location || '').trim()
  const head = promptHead(s.prompt || '')
  const headHit = classifyPlace([loc, head].filter(Boolean).join('｜'))
  if (headHit) return headHit
  // body: visual clauses first, then fuller visual if still empty
  const bodyHit = classifyPlace(placeBlob(s))
  if (bodyHit) return bodyHit
  return classifyPlace((s.visual || '').slice(0, 200))
}

/** Best place hit for a free-text blob; null when nothing matches. */
export function classifyPlace(blob: string): PlaceHit | null {
  let best: PlaceHit | null = null
  for (const r of PLACE_RULES) {
    if (!r.re.test(blob)) continue
    const hit: PlaceHit = { key: r.key, labelZh: r.labelZh, weight: r.weight }
    if (r.key === 'villa_window' && /卧室|床头|枕头|被子|地毯上/.test(blob)) {
      hit.key = 'villa_bedroom'
      hit.labelZh = '江景别墅卧室'
      hit.weight = 42
    }
    if (r.key === 'alley' && /窗|栏杆|铁栏/.test(blob)) {
      hit.key = 'alley_window'
      hit.labelZh = '旧楼窗'
      hit.weight = 38
    }
    if (r.key === 'school_gate' && /奶茶/.test(blob)) continue
    if (!best || hit.weight > best.weight) best = hit
  }
  return best
}

/** Collapse near-synonym place keys so FL2V treats them as one physical space. */
const PLACE_FAMILY: Record<string, string> = {
  villa_window: 'villa_bedroom',
  villa: 'villa_bedroom',
  alley: 'alley_window',
}

export function canonicalPlaceKey(key: string): string {
  return PLACE_FAMILY[key] || key
}

const LABEL_FOR: Record<string, string> = {
  ...Object.fromEntries(PLACE_RULES.map((r) => [r.key, r.labelZh])),
  villa_bedroom: '江景别墅卧室',
  alley_window: '旧楼窗',
  unknown: '未识别场景',
}

export function labelForPlace(key: string): string {
  return LABEL_FOR[key] || LABEL_FOR[canonicalPlaceKey(key)] || key
}

function buildSceneId(placeKey: string, band: TimeBand): string {
  return `${placeKey}_${band === 'unknown' ? 'unknown' : band}`
}

function buildSceneLabel(labelZh: string, band: TimeBand): string {
  const timeZh = TIME_ZH[band]
  return timeZh ? `${labelZh}·${timeZh}` : labelZh
}

/**
 * Classify one shot into a stable sceneId = `{place}_{timeBand}`.
 * When place cues are missing, `fallbackPlace` (previous shot in-run) is used.
 */
export function classifyShotScene(
  shot: ContinuityShot,
  fallbackPlace?: { key: string; labelZh: string } | null,
): SceneFields {
  const band = timeBandOf(shot.timeOfDay, shot.visual, shot.prompt)
  const hit = classifyPlacePreferHeader(shot)
  let key = hit ? canonicalPlaceKey(hit.key) : fallbackPlace?.key || 'unknown'
  let labelZh = hit ? labelForPlace(key) : fallbackPlace?.labelZh || labelForPlace(key)
  const loc = (shot.location || '').trim()
  if (loc && hit) {
    if (loc.length <= 12) labelZh = loc.replace(/[·・].*$/, '') || labelZh
  } else if (loc && !hit) {
    const fromLoc = classifyPlace(loc)
    if (fromLoc) {
      key = canonicalPlaceKey(fromLoc.key)
      labelZh = loc.length <= 12 ? loc.replace(/[·・].*$/, '') : labelForPlace(key)
    }
  }
  return {
    sceneId: buildSceneId(key, band),
    sceneLabel: buildSceneLabel(labelZh, band),
    placeKey: key,
    timeBand: band,
  }
}

/**
 * Overlay-only / system-UI cold open: no on-screen cast + overlay text → hard cut.
 */
export function isOverlayOnlyColdOpen(shot: ContinuityShot): boolean {
  const overlays = shot.overlayText || []
  if (!overlays.length) return false
  if ((shot.characterIds || []).length > 0) return false
  return true
}

/** Majority scene among shots; ties → first shot's scene. */
export function dominantScene(shots: ContinuityShot[]): SceneFields {
  if (!shots.length) {
    return { sceneId: 'unknown_unknown', sceneLabel: '未识别场景', placeKey: 'unknown', timeBand: 'unknown' }
  }
  const classified = shots.map((s) => classifyShotScene(s))
  const counts = new Map<string, number>()
  for (const c of classified) counts.set(c.sceneId, (counts.get(c.sceneId) || 0) + 1)
  let bestId = classified[0].sceneId
  let bestN = 0
  for (const c of classified) {
    const n = counts.get(c.sceneId) || 0
    if (n > bestN) {
      bestN = n
      bestId = c.sceneId
    }
  }
  return classified.find((c) => c.sceneId === bestId) || classified[0]
}

export function scenesCrossed(shots: ContinuityShot[]): boolean {
  if (shots.length < 2) return false
  return new Set(shots.map((s) => classifyShotScene(s).sceneId)).size > 1
}

/**
 * Attach continuity fields to a merged segment from its source shots.
 * Dominant sceneId wins; crossed merges should force carryFromPrev false.
 */
export function sceneFieldsForMerge(sources: ContinuityShot[]): SceneFields & { crossed: boolean } {
  return { ...dominantScene(sources), crossed: scenesCrossed(sources) }
}

/**
 * Annotate shots in episode order with sceneId / sceneLabel / carryFromPrev.
 * Pure: returns new shot objects (shallow copy). Place falls forward within the same time band.
 * Pre-set sceneId/sceneLabel (e.g. from merge dominant) are kept.
 */
export function applySceneContinuity<T extends ContinuityShot>(
  shots: T[],
): (T & SceneFields & { carryFromPrev: boolean })[] {
  const out: (T & SceneFields & { carryFromPrev: boolean })[] = []
  let lastPlace: { key: string; labelZh: string } | null = null
  let lastBand: TimeBand | null = null
  let lastEp: number | null = null
  let prev: (SceneFields & { episode: number; carryFromPrev: boolean }) | null = null

  for (const raw of shots) {
    const ep = raw.episode
    if (ep !== lastEp) {
      lastPlace = null
      lastBand = null
      prev = null
      lastEp = ep
    }
    const bandHint = timeBandOf(raw.timeOfDay, raw.visual, raw.prompt)
    if (lastBand && bandHint !== lastBand && bandHint !== 'unknown' && (lastBand as string) !== 'unknown') {
      lastPlace = null
    }

    let fields: SceneFields
    const preOk =
      raw.sceneId &&
      raw.sceneLabel &&
      !raw.sceneId.endsWith('_unknown') &&
      !raw.sceneId.startsWith('unknown_')
    if (preOk) {
      const parts = raw.sceneId!.match(/^(.*)_((?:night|day|dusk|unknown))$/)
      fields = {
        sceneId: raw.sceneId!,
        sceneLabel: raw.sceneLabel!,
        placeKey: parts?.[1] || classifyShotScene(raw, lastPlace).placeKey,
        timeBand: (parts?.[2] as TimeBand) || classifyShotScene(raw, lastPlace).timeBand,
      }
    } else {
      // missing or unknown: derive with place fall-forward within the time band
      fields = classifyShotScene(raw, lastPlace)
    }

    if (fields.placeKey !== 'unknown') {
      lastPlace = { key: fields.placeKey, labelZh: labelForPlace(fields.placeKey) }
    }
    if (fields.timeBand !== 'unknown') lastBand = fields.timeBand

    let carry = false
    if (prev && prev.episode === ep) {
      carry = prev.sceneId === fields.sceneId && !isOverlayOnlyColdOpen(raw) && !raw._scenesCrossed
    }
    const annotated = { ...raw, ...fields, carryFromPrev: carry }
    delete (annotated as ContinuityShot)._scenesCrossed
    out.push(annotated)
    prev = { ...fields, episode: ep, carryFromPrev: carry }
  }
  return out
}
