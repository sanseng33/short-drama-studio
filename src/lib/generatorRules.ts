/**
 * Generator-side compliance rules ("idea → one-click generate"): the prompt block every storyboard call carries and
 * the self-check that validates an episode's raw LLM storyboard before it is accepted (failures are fed back to the
 * LLM as a repair prompt). Generic only — no show data. The repack gates stay the final validation.
 */
import { DEFAULT_DIALOGUE_PAD, dialogueNeedSec, SHOT_TARGET_SEC } from './dialogueTiming'
import { isVisibleAction } from './actionDensity'
import { locationNamer, normalizeLocation } from './locationNorm'
import { normRealm, realmOfText } from './realm'
import { normCameraSide, normFacing, normHands, normPose, normSide, normVoiceMode } from './blocking'

export const EPISODE_CAP_SEC = 90
export const MAX_ACTIONS_PER_SEGMENT = 2
export const MAX_CAST_PER_SHOT = 2
/** location changes per episode that still read as grouped scenes (a return to an earlier place counts as a switch) */
export const MAX_LOCATION_CHANGES = 3

/** episodes whose total seconds exceed the cap */
export function episodeCapCheck(shots: { episode: number; durationSec: number }[], cap = EPISODE_CAP_SEC): { episode: number; seconds: number }[] {
  const by = new Map<number, number>()
  for (const s of shots) by.set(s.episode, (by.get(s.episode) || 0) + (Number(s.durationSec) || 0))
  return [...by].filter(([, t]) => t > cap + 1e-6).map(([episode, t]) => ({ episode, seconds: Math.round(t * 10) / 10 })).sort((a, b) => a.episode - b.episode)
}

/** the longest dialogue (speech estimate incl. pad) that still fits a shot of `sec` seconds */
export const lineFits = (text: string, sec: number): boolean => dialogueNeedSec([text]) <= sec - 0.5

/** hard rules appended to every storyboard prompt (UI one-click and the headless generator) */
export function complianceBlock(p: { secondsPerEp: number; locations?: string[] }): string {
  const locs = p.locations?.length ? `\n- location 必须从【场景表】中原样选一个：${p.locations.join(' / ')}；同一物理场所全剧同一名字，不加人名/梦中/现实/时间等前后缀。` : ''
  return `【合规硬约束（自检会逐条校验，不合格整集重写）】
- 本集 durationSec 合计 ≤ ${Math.min(p.secondsPerEp + 5, EPISODE_CAP_SEC)} 秒（上限 ${EPISODE_CAP_SEC} 秒）；每镜 ${SHOT_TARGET_SEC.min}–${SHOT_TARGET_SEC.max} 秒。
- 台词：每镜最多一句、一个说话人；按 4 字/秒 + 标点停顿 + ${DEFAULT_DIALOGUE_PAD.headSec + DEFAULT_DIALOGUE_PAD.tailSec} 秒余量估算，必须在本镜时长内说完（9 秒镜约 ≤26 字，6 秒镜约 ≤16 字）；说不完就拆成两镜。
- 动作：action 与 seedancePrompt 时间轴每段最多 ${MAX_ACTIONS_PER_SEGMENT} 个可见动作（有台词的段只做 1 个动作，其余写表情）。
- 同框最多 ${MAX_CAST_PER_SHOT} 人；两人同框镜头的 visual/action/seedancePrompt 禁止用「他/她/他们/她们」，一律写角色名，或写「画面左侧的…/画面右侧的…」；同一场两人左右站位保持不变（screenPos 字段：{"角色名":"left|right"}）。
- 长相相似的不同人物（角色的 lookalikeOf）出现时，visual 必须写出两人的区分特征（年龄感/发型/服装），绝不只写「他」；同一人的造型变体（梦中/现实等）按剧情写对应变体全名。
- 场景分组：同一地点的镜头连续排完再换地点，本集最多换 ${MAX_LOCATION_CHANGES} 次地点，禁止 A→B→A 来回切（交叉剪辑只在剧情必须时用，且每段至少 3 镜）。
- 换地点或换时间（白天/夜）后的第一镜：establishing=true，景别用远景/全景交代环境，carryFromPrev=false；同地点同时间的后续镜头 carryFromPrev=true。
- 起止状态：每个有人物的镜头必须给 startState/endState（画面内每个角色的 pos/facing/pose/gaze/hands）；carryFromPrev=true 时本镜 startState 与上一镜 endState 完全一致，姿势/手持物的变化必须在时间轴里有对应动作；被下一镜承接的镜头最后约 1 秒只保持姿态。
- 站位与机位：每场第一镜给 blocking（左右站位、朝向、门窗在哪侧、谁拿什么），本场人物不换边；每镜给 cameraSide（master/A/B）与 eyeline，A 与 B 之间必须隔一个 master 镜（否则越轴）。
- 一场一套光：每场第一镜给 lighting（key 主光方向、soft 软硬、temp 冷暖），同场每镜光线一致。
- 台词 voiceMode：onscreen / inner / offscreen；inner 与 offscreen 时画面人物嘴唇闭合。
- 场景层 realm：每镜写 reality / dream / memory，同一场相同；梦境/回忆里用角色对应的造型变体；现实与梦境/回忆切换的第一镜 establishing=true、carryFromPrev=false。${locs}`
}

export interface RawShotLike {
  durationSec?: number
  visual?: string
  action?: string
  dialogue?: string
  seedancePrompt?: string
  characters?: string[]
  location?: string
  timeOfDay?: string
  establishing?: boolean
  carryFromPrev?: boolean
  screenPos?: Record<string, string>
  startState?: Record<string, Record<string, unknown>>
  endState?: Record<string, Record<string, unknown>>
  cameraSide?: string
  eyeline?: Record<string, unknown>
  voiceMode?: string
  blocking?: Record<string, unknown>
  lighting?: Record<string, unknown>
  realm?: string
}

export interface StoryboardIssue {
  shot: number | null
  rule: 'duration' | 'episodeSeconds' | 'dialogueFit' | 'speakers' | 'cast' | 'unknownCharacter' | 'location' | 'pronoun' | 'actions' | 'pingPong' | 'timeOfDay' | 'state' | 'stateJump' | 'axisCross' | 'lighting' | 'voiceMode' | 'realm'
  detail: string
}

const PRONOUN = /[他她](?!们)|他们|她们/
const clauses = (t: string) => (t || '').split(/[，,。；;！!？?\n]/).map((x) => x.trim()).filter(Boolean)
const beatLines = (p: string) => (p || '').split('\n').filter((l) => /^\s*\d+(\.\d+)?\s*[–\-~～]\s*\d+(\.\d+)?\s*秒/.test(l))
const visibleCount = (t: string) => clauses(t).filter(isVisibleAction).length

/** speaker prefixes like 「甲：」 in a dialogue string */
const speakersOf = (d: string) => [...new Set([...(d || '').matchAll(/(?:^|[\n。！？!?」])\s*([^\s：:「」，。！？]{1,8})[：:]/g)].map((m) => m[1]))]

/**
 * Validate one episode's raw storyboard shots. Characters / locations are the project lists; returns every issue
 * (empty = accepted). Pure function — the generator turns the issues into a repair prompt.
 */
export function validateStoryboard(
  shots: RawShotLike[],
  ctx: { characters: { name: string; baseName?: string }[]; locations?: string[]; secondsPerEp: number; cap?: number },
): StoryboardIssue[] {
  const out: StoryboardIssue[] = []
  const cap = Math.min(ctx.cap ?? EPISODE_CAP_SEC, ctx.secondsPerEp + 5)
  const names = new Set(ctx.characters.map((c) => c.name))
  const namer = locationNamer(ctx.characters)
  const canon = new Map((ctx.locations || []).map((l) => [normalizeLocation(l, namer) || l, l]))
  let total = 0
  shots.forEach((s, i) => {
    const n = i + 1
    const d = Number(s.durationSec) || 0
    total += d
    if (d < SHOT_TARGET_SEC.min || d > SHOT_TARGET_SEC.max) out.push({ shot: n, rule: 'duration', detail: `durationSec ${d} 不在 ${SHOT_TARGET_SEC.min}–${SHOT_TARGET_SEC.max}` })
    const line = (s.dialogue || '').replace(/^[^：:]{1,8}[：:]/, '')
    if (line.trim() && !lineFits(line, d)) out.push({ shot: n, rule: 'dialogueFit', detail: `台词约需 ${dialogueNeedSec([line]).toFixed(1)}s，镜长 ${d}s：缩短台词或拆镜` })
    if (speakersOf(s.dialogue || '').length > 1) out.push({ shot: n, rule: 'speakers', detail: '一镜只能一个说话人' })
    const cast = s.characters || []
    if (cast.length > MAX_CAST_PER_SHOT) out.push({ shot: n, rule: 'cast', detail: `同框 ${cast.length} 人 > ${MAX_CAST_PER_SHOT}` })
    for (const c of cast) if (!names.has(c)) out.push({ shot: n, rule: 'unknownCharacter', detail: `角色「${c}」不在角色列表` })
    if (cast.length >= 2) {
      const t = [s.visual, s.action, s.seedancePrompt].join('\n')
      if (PRONOUN.test(t)) out.push({ shot: n, rule: 'pronoun', detail: '两人同框镜头含 他/她：改写为角色名或画面左侧/右侧的…' })
    }
    const busy = [s.action || '', ...beatLines(s.seedancePrompt || '')].map(visibleCount)
    if (busy.some((k) => k > MAX_ACTIONS_PER_SEGMENT)) out.push({ shot: n, rule: 'actions', detail: `某段可见动作 ${Math.max(...busy)} 个 > ${MAX_ACTIONS_PER_SEGMENT}` })
    if (canon.size) {
      const loc = (s.location || '').trim()
      if (!loc || (!ctx.locations!.includes(loc) && !canon.has(normalizeLocation(loc, namer)))) out.push({ shot: n, rule: 'location', detail: `location「${loc}」不在场景表` })
    }
    if (!(s.timeOfDay || '').trim()) out.push({ shot: n, rule: 'timeOfDay', detail: '缺 timeOfDay' })
  })
  if (total > cap + 1e-6) out.push({ shot: null, rule: 'episodeSeconds', detail: `本集合计 ${total}s > ${cap}s` })
  // P0-1/2/3: start / end states, carry continuity, axis, scene lighting, voice mode
  out.push(...validateContinuity(shots, namer))
  // grouped scenes: count place switches and returns to an earlier place
  const seq = shots.map((s) => normalizeLocation(s.location, namer) || (s.location || '').trim())
  let changes = 0
  const seen = new Set<string>()
  const returns: string[] = []
  seq.forEach((k, i) => {
    if (i && k !== seq[i - 1]) {
      changes++
      if (seen.has(k)) returns.push(k)
    }
    seen.add(k)
  })
  if (changes > MAX_LOCATION_CHANGES || returns.length) out.push({ shot: null, rule: 'pingPong', detail: `换地点 ${changes} 次${returns.length ? `，回到已离开的地点：${[...new Set(returns)].join('/')}` : ''}；同地点镜头请连续排` })
  return out
}

/** generic auto-fix (no LLM): canonical location names, establishing / carry flags at place or time-band changes */
export function autoFixStoryboard<T extends RawShotLike>(shots: T[], ctx: { characters: { name: string; baseName?: string }[]; locations?: string[] }): T[] {
  const namer = locationNamer(ctx.characters)
  const canon = new Map((ctx.locations || []).map((l) => [normalizeLocation(l, namer) || l, l]))
  const band = (t?: string) => (/(夜|晚|深夜|凌晨|黄昏|傍晚)/.test(t || '') ? 'night' : 'day')
  const fixed: T[] = []
  shots.forEach((s, i) => {
    const loc = canon.get(normalizeLocation(s.location, namer)) || s.location
    const prev = i ? fixed[i - 1] : null
    const prevLoc = prev ? prev.location : null
    const place = !prev || prevLoc !== loc || band(prev.timeOfDay) !== band(s.timeOfDay)
    // realm: the generator's value, else the scene's (same place) or the shot's own text, else reality
    const realm = normRealm(s.realm) || (!place && prev?.realm) || realmOfText(`${s.location || ''} ${s.visual || ''}`) || 'reality'
    const change = place || prev!.realm !== realm
    fixed.push({ ...s, ...(loc ? { location: loc } : {}), realm, establishing: change, carryFromPrev: change ? false : s.carryFromPrev !== false })
  })
  return autoFixContinuity(fixed, namer)
}

/** repair prompt for the LLM from a list of issues */
export function repairPrompt(issues: StoryboardIssue[]): string {
  return `上一版分镜未通过自检，请输出完整修正后的 JSON 数组（全部镜头，不要只给改动），逐条修正：\n${issues
    .slice(0, 40)
    .map((x) => `- ${x.shot ? `第${x.shot}镜` : '全集'} [${x.rule}] ${x.detail}`)
    .join('\n')}`
}

// ---------------- P0-1/2/3 (generator side) ----------------
type StateLike = { pos: string; facing: string; pose: string; gaze: string; hands: string }
/** name-keyed raw state → normalised name-keyed state (enum values normalised for strict comparison) */
export function normRawState(raw: unknown): Record<string, StateLike> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, StateLike> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const pos = normSide(o.pos)
    if (!pos) continue
    out[k.trim()] = { pos, facing: normFacing(o.facing) || 'front', pose: normPose(o.pose) || '站', gaze: String(o.gaze ?? '').trim() || 'front', hands: normHands(o.hands) }
  }
  return Object.keys(out).length ? out : null
}
const lightSig = (l: unknown): string | null => {
  if (!l || typeof l !== 'object') return null
  const o = l as Record<string, unknown>
  const key = String(o.key ?? '').trim()
  return key ? `${key}|${o.soft === false || /硬|hard/i.test(String(o.soft)) ? 'hard' : 'soft'}|${String(o.temp ?? '').trim()}` : null
}
const runKey = (s: RawShotLike, namer: ReturnType<typeof locationNamer>) => `${normalizeLocation(s.location, namer) || (s.location || '').trim()}|${/(夜|晚|凌晨|黄昏|傍晚)/.test(s.timeOfDay || '') ? 'night' : 'day'}|${normRealm(s.realm) || 'reality'}`

export function validateContinuity(shots: RawShotLike[], namer: ReturnType<typeof locationNamer>): StoryboardIssue[] {
  const out: StoryboardIssue[] = []
  let lastSide: string | null = null
  let runLight: string | null = null
  let runCast = new Set<string>()
  shots.forEach((s, i) => {
    const n = i + 1
    const cast = s.characters || []
    const prev = i ? shots[i - 1] : null
    const newRun = !prev || runKey(prev, namer) !== runKey(s, namer)
    if (newRun) (lastSide = null, (runLight = lightSig(s.lighting)))
    const st = normRawState(s.startState)
    const en = normRawState(s.endState)
    if (cast.length && (!st || !en || cast.some((c) => !st[c] || !en[c]))) out.push({ shot: n, rule: 'state', detail: '缺 startState/endState（画面内每个角色的 pos/facing/pose/gaze/hands）' })
    if (prev && s.carryFromPrev && st) {
      const pe = normRawState(prev.endState)
      for (const [c, a] of Object.entries(pe || {})) {
        const b = st[c]
        if (!b) continue
        const diff = (['pos', 'facing', 'pose', 'gaze', 'hands'] as const).filter((k) => a[k] !== b[k])
        if (diff.length) out.push({ shot: n, rule: 'stateJump', detail: `「${c}」与上一镜末帧不一致：${diff.map((k) => `${k} ${a[k]}→${b[k]}`).join('，')}` })
      }
    }
    const side = normCameraSide(s.cameraSide)
    if (cast.length && !side) out.push({ shot: n, rule: 'axisCross', detail: '缺 cameraSide（master/A/B）' })
    // the 180° line exists only between two people of the scene (solo scenes have no axis)
    if (newRun) runCast = new Set()
    for (const c of cast) runCast.add(c)
    if (side && cast.length >= 1 && runCast.size >= 2) {
      if (lastSide && side !== 'master' && lastSide !== 'master' && side !== lastSide) out.push({ shot: n, rule: 'axisCross', detail: `机位 ${lastSide}→${side} 中间没有 master 镜（越轴）` })
      lastSide = side
    }
    if (newRun && cast.length && !lightSig(s.lighting)) out.push({ shot: n, rule: 'lighting', detail: '本场第一镜缺 lighting（key/soft/temp）' })
    const ls = lightSig(s.lighting)
    if (!newRun && ls && runLight && ls !== runLight) out.push({ shot: n, rule: 'lighting', detail: `同场光线不一致：${ls} ≠ ${runLight}` })
    // a missing realm is filled by autoFixStoryboard (scene / text / reality); an invalid one is an error
    if (s.realm && !normRealm(s.realm)) out.push({ shot: n, rule: 'realm', detail: `realm「${s.realm}」无效，只能是 reality/dream/memory` })
    if (prev && (normRealm(s.realm) || 'reality') !== (normRealm(prev.realm) || 'reality') && s.carryFromPrev) out.push({ shot: n, rule: 'realm', detail: '现实与梦境/回忆切换时不能 carryFromPrev' })
    if ((s.dialogue || '').trim() && s.voiceMode && !normVoiceMode(s.voiceMode)) out.push({ shot: n, rule: 'voiceMode', detail: `voiceMode「${s.voiceMode}」不是 onscreen/inner/offscreen` })
  })
  return out
}

/**
 * generic auto-fix of the P0 fields (no LLM): enum normalisation, carry → startState := previous endState for shared
 * characters, scene lighting + blocking locked to the run's first value (same place + time band)
 */
export function autoFixContinuity<T extends RawShotLike>(shots: T[], namer: ReturnType<typeof locationNamer>): T[] {
  let light: Record<string, unknown> | undefined
  let blocking: Record<string, unknown> | undefined
  let runPos: Record<string, string> = {}
  const out: T[] = []
  shots.forEach((s0, i) => {
    const s = { ...s0 } as T
    const prev = i ? out[i - 1] : null
    const newRun = !prev || runKey(prev, namer) !== runKey(s, namer)
    if (newRun) (light = s.lighting && lightSig(s.lighting) ? s.lighting : undefined, (blocking = s.blocking && typeof s.blocking === 'object' ? s.blocking : undefined))
    if (!light && lightSig(s.lighting)) light = s.lighting
    if (!blocking && s.blocking && typeof s.blocking === 'object') blocking = s.blocking
    if (light) s.lighting = light
    if (blocking) s.blocking = blocking
    const st = normRawState(s.startState)
    const en = normRawState(s.endState)
    if (st) s.startState = st as never
    if (en) s.endState = en as never
    let side = normCameraSide(s.cameraSide)
    // B = the camera really crossed the line (positions mirrored); B with the run's own sides is a shot / reverse-shot → A
    if (newRun) runPos = {}
    const bp = (blocking?.positions || {}) as Record<string, unknown>
    for (const [c, v] of Object.entries(bp)) if (!(c in runPos) && normSide(v)) runPos[c] = normSide(v)!
    if (side === 'B' && st && Object.entries(st).every(([c, x]) => !runPos[c] || x.pos === runPos[c] || x.pos === 'center')) side = 'A'
    if (side !== 'B' && st) for (const [c, x] of Object.entries(st)) if (!(c in runPos) && x.pos !== 'center') runPos[c] = x.pos
    if (side) s.cameraSide = side
    const vm = normVoiceMode(s.voiceMode)
    if (vm) s.voiceMode = vm
    const rl = normRealm(s.realm)
    if (rl) s.realm = rl
    if (prev && s.carryFromPrev && st) {
      const pe = normRawState(prev.endState) || {}
      const fixed = { ...st }
      for (const c of Object.keys(st)) if (pe[c]) fixed[c] = { ...pe[c] }
      s.startState = fixed as never
    }
    out.push(s)
  })
  return out
}
