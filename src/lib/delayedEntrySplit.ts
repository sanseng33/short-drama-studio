/**
 * Delayed-entry shots (structured offscreen → enter) are split into two shots
 * because current video models cannot hard-control mid-shot entry time.
 *
 * Pre: first-frame-visible characters only; the entering character is not in
 * characterIds and must not receive a reference binding on this shot.
 * Post: first frame includes the entering character.
 *
 * Timing uses events[].atSec when it is a finite time inside the shot; otherwise
 * duration is split in half on the pack duration step (untimed, not verified).
 * Execution then raises each part to at least DELAYED_ENTRY_MIN_SEC (5) and the
 * pair to at least max(source, 10), preserving ratio when possible. A 7s source
 * therefore executes as 5+5=10; warnings must say the source 7s was extended
 * and must not claim it was preserved. Visual / action prose is not parsed to invent atSec.
 */
import type { Character, Shot } from '../types'
import { firstFrameOnscreenIds } from './shotAnnotate'
import { mapNamesToIds } from './shotCast'

export const DELAYED_ENTRY_SPLIT_CODE = 'delayed_entry_split' as const
export const DELAYED_ENTRY_SPLIT_UNTIMED_CODE = 'delayed_entry_split_untimed' as const
export const DELAYED_ENTRY_DURATION_BELOW_MIN_CODE = 'delayed_entry_duration_below_min' as const
export const DELAYED_ENTRY_DURATION_EXTENDED_CODE = 'delayed_entry_duration_extended' as const
/** Execution floor for each delayed-entry part; keep in sync with SEGMENT_MIN_SEC. */
export const DELAYED_ENTRY_MIN_SEC = 5

export type DelayedEntrySplitPart = 'pre' | 'post'

export type DelayedEntrySplitWarningCode =
  | typeof DELAYED_ENTRY_SPLIT_CODE
  | typeof DELAYED_ENTRY_SPLIT_UNTIMED_CODE
  | typeof DELAYED_ENTRY_DURATION_BELOW_MIN_CODE
  | typeof DELAYED_ENTRY_DURATION_EXTENDED_CODE

export interface DelayedEntrySplitWarning {
  shotId: string
  code: DelayedEntrySplitWarningCode
  message: string
  enterIds: string[]
  episode?: number
}

export interface DelayedEntryPlan {
  presentIds: string[]
  enterIds: string[]
  atSec?: number
  untimed: boolean
  /** Raw parent durationSec (before step snap used to split). */
  sourceSec: number
  preSec: number
  postSec: number
}

const DEFAULT_STEP = 0.5

function uniq(ids: string[]): string[] {
  const out: string[] = []
  for (const id of ids) if (id && !out.includes(id)) out.push(id)
  return out
}

function stateIds(state: unknown, chars: readonly Character[]): string[] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return []
  const out: string[] = []
  for (const key of Object.keys(state as object)) {
    const [id] = mapNamesToIds([key], chars as never)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

function pickState(state: unknown, ids: string[], chars: readonly Character[]): Record<string, unknown> | undefined {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(state as Record<string, unknown>)) {
    const [id] = mapNamesToIds([key], chars as never)
    const resolved = id || (ids.includes(key) ? key : null)
    if (resolved && ids.includes(resolved)) out[key] = val
  }
  return Object.keys(out).length ? out : undefined
}

function displayName(id: string, chars: readonly Character[]): string {
  const c = chars.find((x) => x.id === id)
  return (c?.name || c?.baseName || id).trim()
}

function snapStep(sec: number, step: number): number {
  return Math.round(sec / step) * step
}

export function splitDurations(
  totalSec: number,
  atSec: number | undefined,
  step = DEFAULT_STEP,
  minSec = DELAYED_ENTRY_MIN_SEC,
): { preSec: number; postSec: number; untimed: boolean; sourceSec: number; extended: boolean } {
  const sourceSec = Math.max(step, snapStep(Number(totalSec) || 0, step) || step)
  const untimed = !(typeof atSec === 'number' && Number.isFinite(atSec))
  let rawPre = untimed ? snapStep(sourceSec / 2, step) : snapStep(atSec as number, step)
  if (rawPre < step) rawPre = step
  if (rawPre > sourceSec - step) rawPre = Math.max(step, sourceSec - step)
  const rawPost = Math.max(step, snapStep(sourceSec - rawPre, step))
  const floor = minSec > 0 ? Math.max(step, snapStep(minSec, step)) : step
  const minTotal = Math.max(sourceSec, snapStep(2 * floor, step))
  const rawSum = rawPre + rawPost || minTotal
  let pre = snapStep((rawPre / rawSum) * minTotal, step)
  if (pre < floor) pre = floor
  if (pre > minTotal - floor) pre = Math.max(floor, minTotal - floor)
  let post = snapStep(minTotal - pre, step)
  if (post < floor) {
    post = floor
    pre = snapStep(minTotal - post, step)
  }
  const extended = Math.abs(pre + post - sourceSec) > 1e-9
  return { preSec: pre, postSec: post, untimed, sourceSec, extended }
}

function enterAtSec(shot: Shot): number | undefined {
  const events = shot.events
  if (!Array.isArray(events)) return undefined
  const hits = events
    .filter((e) => e && typeof e.kind === 'string' && e.kind.trim() === 'enter' && typeof e.atSec === 'number' && Number.isFinite(e.atSec))
    .map((e) => e.atSec as number)
  if (!hits.length) return undefined
  return Math.min(...hits)
}

/** Structured delayed entry only. No prose inference. */
export function delayedEntryPlan(shot: Shot, chars: readonly Character[], step = DEFAULT_STEP, minSec = DELAYED_ENTRY_MIN_SEC): DelayedEntryPlan | null {
  const present = firstFrameOnscreenIds(shot, chars as never)
  if (!present || !present.length) return null
  const endIds = stateIds(shot.endState, chars)
  const involved = uniq([...present, ...mapNamesToIds(shot.characterIds, chars as never), ...endIds])
  const enterIds = involved.filter((id) => !present.includes(id))
  if (!enterIds.length) return null
  const atSec = enterAtSec(shot)
  const sourceSec = Number(shot.durationSec) || 0
  const { preSec, postSec, untimed } = splitDurations(sourceSec, atSec, step, minSec)
  return { presentIds: present, enterIds, ...(atSec != null ? { atSec } : {}), untimed, sourceSec, preSec, postSec }
}

function constraintLine(part: DelayedEntrySplitPart, presentIds: string[], enterIds: string[], chars: readonly Character[]): string {
  const here = presentIds.map((id) => displayName(id, chars)).join('、')
  const enter = enterIds.map((id) => displayName(id, chars)).join('、')
  if (part === 'pre') {
    return `限制：本镜是入画前一段，画面内只有${here}，不得出现${enter}，不要挂入画角色的参考。`
  }
  return `限制：本镜是入画段，首帧即包含${enter}。`
}

function withConstraint(text: string | undefined, line: string, part: DelayedEntrySplitPart): string {
  let raw = (text || '').trim()
  // The inherited first-frame-only constraint from the unsplit shot contradicts a post shot whose first frame includes the enterer.
  if (part === 'post') raw = raw.replace(/限制：首帧画面内只有[^。\n]*。/g, '')
  raw = raw.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  if (raw.includes(line)) return raw
  return raw ? `${raw}\n${line}` : line
}

function partShot(
  shot: Shot,
  part: DelayedEntrySplitPart,
  plan: DelayedEntryPlan,
  chars: readonly Character[],
): Shot {
  const ids = part === 'pre' ? plan.presentIds : uniq([...plan.presentIds, ...plan.enterIds])
  const dur = part === 'pre' ? plan.preSec : plan.postSec
  const suffix = part === 'pre' ? 'a' : 'b'
  const line = constraintLine(part, plan.presentIds, plan.enterIds, chars)
  const startState = part === 'pre' ? pickState(shot.startState, plan.presentIds, chars) || shot.startState : pickState(shot.endState, ids, chars) || shot.endState
  const endState = part === 'pre' ? pickState(shot.endState, plan.presentIds, chars) || pickState(shot.startState, plan.presentIds, chars) : shot.endState
  const firstFrame = ids.map((id) => ({ id, kind: 'unverified' }))
  const wardrobe = shot.wardrobeState && typeof shot.wardrobeState === 'object'
    ? Object.fromEntries(Object.entries(shot.wardrobeState).filter(([k]) => {
        const [id] = mapNamesToIds([k], chars as never)
        return ids.includes(id || k)
      }))
    : undefined
  const voiceOnly = part === 'pre'
    ? (shot.voiceOnly || []).filter((v) => {
        const [id] = mapNamesToIds([v], chars as never)
        return !plan.enterIds.includes(id || v)
      })
    : shot.voiceOnly
  return {
    ...shot,
    id: `${shot.id}-${suffix}`,
    durationSec: dur,
    characterIds: ids,
    ...(voiceOnly && voiceOnly.length ? { voiceOnly } : { voiceOnly: [] }),
    ...(wardrobe && Object.keys(wardrobe).length ? { wardrobeState: wardrobe } : { wardrobeState: undefined }),
    startState: startState as Shot['startState'],
    endState: endState as Shot['endState'],
    firstFrame,
    events: [],
    visual: withConstraint(shot.visual, line, part),
    action: withConstraint(shot.action, line, part),
    seedancePrompt: withConstraint(shot.seedancePrompt, line, part),
    delayedEntrySplit: part,
    splitFrom: shot.id,
    splitSourceDurationSec: plan.sourceSec,
    splitPlannedDurationSec: dur,
    splitUntimed: plan.untimed,
  }
}

export function splitDelayedEntryShots(
  shots: Shot[],
  chars: readonly Character[],
  step = DEFAULT_STEP,
  minSec = DELAYED_ENTRY_MIN_SEC,
): { shots: Shot[]; warnings: DelayedEntrySplitWarning[] } {
  const out: Shot[] = []
  const warnings: DelayedEntrySplitWarning[] = []
  for (const shot of shots) {
    if (shot.delayedEntrySplit) {
      out.push(shot)
      continue
    }
    const plan = delayedEntryPlan(shot, chars, step, minSec)
    if (!plan) {
      out.push(shot)
      continue
    }
    const pre = partShot(shot, 'pre', plan, chars)
    const post = partShot(shot, 'post', plan, chars)
    out.push(pre, post)
    warnings.push({
      shotId: shot.id,
      code: DELAYED_ENTRY_SPLIT_CODE,
      message: `延迟入画（${plan.enterIds.join('、')}）已拆成前后两镜 ${pre.id}/${post.id}；前镜不挂入画角色参考，后镜首帧包含入画角色`,
      enterIds: plan.enterIds,
    })
    if (plan.untimed) {
      warnings.push({
        shotId: shot.id,
        code: DELAYED_ENTRY_SPLIT_UNTIMED_CODE,
        message: `入画 events 无可用 atSec，按 ${plan.preSec}+${plan.postSec}s 结构对半拆分，此时长不是已核验时间`,
        enterIds: plan.enterIds,
      })
    }
  }
  return { shots: out, warnings }
}


export function formatDurationSec(sec: number): string {
  const n = Math.round(Number(sec) * 1000) / 1000
  if (Number.isInteger(n)) return String(n)
  return String(n)
}

export type DelayedEntryDurationShot = {
  id: string
  episode?: number
  durationSec: number
  delayedEntrySplit?: 'pre' | 'post'
  splitFrom?: string
  splitSourceDurationSec?: number
  splitPlannedDurationSec?: number
  splitUntimed?: boolean
  characterIds?: string[]
}

const DURATION_WARNING_CODES: readonly DelayedEntrySplitWarningCode[] = [
  DELAYED_ENTRY_SPLIT_CODE,
  DELAYED_ENTRY_SPLIT_UNTIMED_CODE,
  DELAYED_ENTRY_DURATION_BELOW_MIN_CODE,
  DELAYED_ENTRY_DURATION_EXTENDED_CODE,
]

function nearly(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps
}

/** Rewrite delayed-entry duration warnings from the FINAL exported shots so messages match execution durations. */
export function finalizeDelayedEntryDurationWarnings<W extends { shotId?: string; code: string; message: string; episode?: number }>(
  shots: readonly DelayedEntryDurationShot[],
  warnings: W[],
  minSec: number,
): W[] {
  const groups = new Map<string, { pre?: DelayedEntryDurationShot; post?: DelayedEntryDurationShot }>()
  for (const s of shots) {
    if (!s.delayedEntrySplit || !s.splitFrom) continue
    const g = groups.get(s.splitFrom) || {}
    if (s.delayedEntrySplit === 'pre') g.pre = s
    else g.post = s
    groups.set(s.splitFrom, g)
  }
  const durationCodes = new Set<string>(DURATION_WARNING_CODES)
  const kept = warnings.filter((w) => !w.shotId || !groups.has(w.shotId) || !durationCodes.has(w.code))
  const extra: DelayedEntrySplitWarning[] = []
  for (const [parentId, g] of groups) {
    const pre = g.pre
    const post = g.post
    if (!pre || !post) continue
    const source = pre.splitSourceDurationSec ?? post.splitSourceDurationSec ?? (pre.splitPlannedDurationSec || 0) + (post.splitPlannedDurationSec || 0)
    const plannedPre = pre.splitPlannedDurationSec ?? pre.durationSec
    const plannedPost = post.splitPlannedDurationSec ?? post.durationSec
    const execPre = pre.durationSec
    const execPost = post.durationSec
    const plannedSum = Math.round((plannedPre + plannedPost) * 1000) / 1000
    const execSum = Math.round((execPre + execPost) * 1000) / 1000
    const untimed = pre.splitUntimed === true || post.splitUntimed === true || warnings.some((w) => w.shotId === parentId && w.code === DELAYED_ENTRY_SPLIT_UNTIMED_CODE)
    const prev = warnings.find((w) => w.shotId === parentId && w.code === DELAYED_ENTRY_SPLIT_CODE)
    const enter = (prev?.message.match(/延迟入画（([^）]+)）/) || [])[1] || ''
    const enterIds = enter ? enter.split('、').filter(Boolean) : []
    const episode = pre.episode ?? post.episode
    const durClause = `源时长 ${formatDurationSec(source)}s，执行计划 ${formatDurationSec(plannedPre)}+${formatDurationSec(plannedPost)}s（合计 ${formatDurationSec(plannedSum)}s），执行时长 ${formatDurationSec(execPre)}+${formatDurationSec(execPost)}s（合计 ${formatDurationSec(execSum)}s）`
    const execMatchesPlan = nearly(execPre, plannedPre) && nearly(execPost, plannedPost) && nearly(execSum, plannedSum)
    const sourcePreserved = nearly(execSum, source)
    const preserveNote = sourcePreserved
      ? `源时长按前后合计保留为 ${formatDurationSec(execPre)}+${formatDurationSec(execPost)}s，不是单镜 ${formatDurationSec(source)}s，也不是已核验入画时间`
      : `源时长 ${formatDurationSec(source)}s 被执行扩展为 ${formatDurationSec(execSum)}s（${formatDurationSec(execPre)}+${formatDurationSec(execPost)}s），不得声称源 ${formatDurationSec(source)}s 被保留`
    extra.push({
      shotId: parentId,
      code: DELAYED_ENTRY_SPLIT_CODE,
      enterIds,
      ...(episode != null ? { episode } : {}),
      message: `延迟入画（${enter || '未知'}）已拆成前后两镜 ${pre.id}/${post.id}；前镜不挂入画角色参考，后镜首帧包含入画角色。${durClause}。${preserveNote}`,
    })
    if (untimed) {
      extra.push({
        shotId: parentId,
        code: DELAYED_ENTRY_SPLIT_UNTIMED_CODE,
        enterIds,
        ...(episode != null ? { episode } : {}),
        message: `入画 events 无可用 atSec。源时长 ${formatDurationSec(source)}s；因每段最短 ${formatDurationSec(minSec)}s，执行计划与执行时长均为 ${formatDurationSec(plannedPre)}+${formatDurationSec(plannedPost)}s（合计 ${formatDurationSec(plannedSum)}s）。此时长不是已核验入画时间。${preserveNote}`,
      })
    }
    if (execPre + 1e-9 < minSec || execPost + 1e-9 < minSec) {
      extra.push({
        shotId: parentId,
        code: DELAYED_ENTRY_DURATION_BELOW_MIN_CODE,
        enterIds,
        ...(episode != null ? { episode } : {}),
        message: `前镜执行 ${formatDurationSec(execPre)}s、后镜执行 ${formatDurationSec(execPost)}s，仍低于段/模型最短 ${formatDurationSec(minSec)}s（规则应将每段至少抬到 ${formatDurationSec(minSec)}s）。此导出不能当作已满足最短时长的执行包`,
      })
    }
    if (!sourcePreserved || !execMatchesPlan) {
      extra.push({
        shotId: parentId,
        code: DELAYED_ENTRY_DURATION_EXTENDED_CODE,
        enterIds,
        ...(episode != null ? { episode } : {}),
        message: execMatchesPlan
          ? `源时长 ${formatDurationSec(source)}s 被执行扩展为 ${formatDurationSec(execSum)}s（${formatDurationSec(execPre)}+${formatDurationSec(execPost)}s），不得声称源 ${formatDurationSec(source)}s 被保留`
          : `执行时长 ${formatDurationSec(execPre)}+${formatDurationSec(execPost)}s（合计 ${formatDurationSec(execSum)}s）与执行计划 ${formatDurationSec(plannedPre)}+${formatDurationSec(plannedPost)}s / 源时长 ${formatDurationSec(source)}s 不一致，源时长未被保留`,
      })
    }
  }
  const out = [...kept]
  for (const w of extra) {
    out.push({ episode: w.episode ?? 0, shotId: w.shotId, code: w.code, message: w.message } as W)
  }
  return out
}
