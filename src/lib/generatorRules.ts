/**
 * Generator-side compliance rules ("idea → one-click generate"): the prompt block every storyboard call carries and
 * the self-check that validates an episode's raw LLM storyboard before it is accepted (failures are fed back to the
 * LLM as a repair prompt). Generic only — no show data. The repack gates stay the final validation.
 */
import { DEFAULT_DIALOGUE_PAD, dialogueNeedSec, SHOT_TARGET_SEC } from './dialogueTiming'
import { isVisibleAction } from './actionDensity'
import { locationNamer, normalizeLocation } from './locationNorm'

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
- 场景分组：同一地点的镜头连续排完再换地点，本集最多换 ${MAX_LOCATION_CHANGES} 次地点，禁止 A→B→A 来回切（交叉剪辑只在剧情必须时用，且每段至少 3 镜）。
- 换地点或换时间（白天/夜）后的第一镜：establishing=true，景别用远景/全景交代环境，carryFromPrev=false；同地点同时间的后续镜头 carryFromPrev=true。${locs}`
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
}

export interface StoryboardIssue {
  shot: number | null
  rule: 'duration' | 'episodeSeconds' | 'dialogueFit' | 'speakers' | 'cast' | 'unknownCharacter' | 'location' | 'pronoun' | 'actions' | 'pingPong' | 'timeOfDay'
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
  return shots.map((s, i) => {
    const loc = canon.get(normalizeLocation(s.location, namer)) || s.location
    const prev = i ? shots[i - 1] : null
    const prevLoc = prev ? canon.get(normalizeLocation(prev.location, namer)) || prev.location : null
    const change = !prev || prevLoc !== loc || band(prev.timeOfDay) !== band(s.timeOfDay)
    return { ...s, ...(loc ? { location: loc } : {}), establishing: change, carryFromPrev: change ? false : s.carryFromPrev !== false }
  })
}

/** repair prompt for the LLM from a list of issues */
export function repairPrompt(issues: StoryboardIssue[]): string {
  return `上一版分镜未通过自检，请输出完整修正后的 JSON 数组（全部镜头，不要只给改动），逐条修正：\n${issues
    .slice(0, 40)
    .map((x) => `- ${x.shot ? `第${x.shot}镜` : '全集'} [${x.rule}] ${x.detail}`)
    .join('\n')}`
}
