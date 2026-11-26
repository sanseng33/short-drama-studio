/**
 * Per-episode / per-shot storyboard locks, merge of a locked board with a new LLM draft,
 * and single-shot replace that re-runs in-scene continuity.
 */
import type { Project, Shot } from '../../types'
import { extractAnchors, formatDecorAnchors, shotAnchorText } from '../sceneAnchors'
import { autoFixStoryboard, validateContinuity, validateStoryboard, type RawShotLike, type StoryboardIssue } from '../generatorRules'
import { locationNamer } from '../locationNorm'

export function isEpisodeStoryboardLocked(project: Project, episode: number): boolean {
  return Boolean(project.locks?.storyboards?.[episode])
}

export function isShotLocked(project: Project, episode: number, shotId: string): boolean {
  if (isEpisodeStoryboardLocked(project, episode)) return true
  return Boolean(project.locks?.shots?.[shotId])
}

export function lockedShotsOf(project: Project, episode: number): Shot[] {
  const shots = project.storyboards?.[episode] || []
  if (isEpisodeStoryboardLocked(project, episode)) return shots.slice()
  const flag = project.locks?.shots
  if (!flag) return []
  return shots.filter((s) => flag[s.id])
}

export function lockedShotIds(project: Project, episode: number): string[] {
  return lockedShotsOf(project, episode).map((s) => s.id)
}

/** Merge generated (possibly partial) shots with locked copies. Locked bodies always win. */
export function mergeGeneratedWithLocked<T extends RawShotLike & { id?: string; shotNo?: number }>(generated: T[], locked: T[]): T[] {
  if (!locked.length) return generated
  const byId = new Map(locked.map((s) => [s.id, s]))
  const byNo = new Map(locked.filter((s) => s.shotNo != null).map((s) => [s.shotNo as number, s]))
  const lockedIds = new Set(locked.map((s) => s.id).filter((id): id is string => Boolean(id)))
  const lockedNos = new Set(locked.map((s) => s.shotNo).filter((n): n is number => n != null))
  const unlocked = generated.filter((s) => !(s.id && lockedIds.has(s.id)) && !(s.shotNo != null && lockedNos.has(s.shotNo)))
  const merged = [...locked, ...unlocked]
  merged.sort((a, b) => (a.shotNo || 0) - (b.shotNo || 0) || String(a.id || '').localeCompare(String(b.id || '')))
  return merged.map((s) => (s.id && byId.get(s.id)) || (s.shotNo != null && byNo.get(s.shotNo)) || s)
}

export function lockConstraintBlock(locked: Shot[]): string {
  if (!locked.length) return ''
  const lines = locked.map((s) => {
    const anchors = formatDecorAnchors(extractAnchors(shotAnchorText(s)))
    const bits = [`id=${s.id}`, `shotNo=${s.shotNo}`, `location=${s.location || ''}`, `size=${s.size}`, `camera=${s.camera}`]
    if (anchors) bits.push(`陈设锚点：${anchors}`)
    bits.push(`visual：${s.visual || ''}`)
    return `- ${bits.join('；')}`
  })
  return `【已锁定镜头，禁止改写正文、不要输出这些镜头】\n${lines.join('\n')}\n只输出未锁定镜头的 JSON 数组。新镜头若与已锁定镜头同一地点、同一时间带、同一 realm，陈设锚点只可省略、不可写成相反集合。`
}

export interface ReplaceShotResult {
  project: Project
  issues: StoryboardIssue[]
}

/**
 * Replace one shot in an episode, then re-run storyboard / in-scene continuity checks.
 * Does not mutate the locked body of another shot; will not rewrite a locked target either.
 */
export function replaceEpisodeShot(project: Project, episode: number, shot: Shot): ReplaceShotResult {
  const prev = project.storyboards?.[episode] || []
  if (isShotLocked(project, episode, shot.id) && prev.some((s) => s.id === shot.id)) {
    const namer = locationNamer(project.characters)
    return { project, issues: validateContinuity(prev as RawShotLike[], namer) }
  }
  const idx = prev.findIndex((s) => s.id === shot.id)
  const nextShots = prev.slice()
  if (idx >= 0) nextShots[idx] = shot
  else nextShots.push(shot)
  nextShots.sort((a, b) => a.shotNo - b.shotNo)
  const ctx = { characters: project.characters, locations: project.locations, secondsPerEp: project.secondsPerEp }
  const issues = validateStoryboard(nextShots as RawShotLike[], ctx)
  const next: Project = {
    ...project,
    storyboards: { ...project.storyboards, [episode]: nextShots },
    updatedAt: project.updatedAt,
  }
  return { project: next, issues }
}

/** Restore locked bodies after autoFix / validate so a repair loop cannot rewrite them. */
export function restoreLockedAfterFix<T extends RawShotLike & { id?: string; shotNo?: number }>(shots: T[], locked: T[], ctx: { characters: { name: string; baseName?: string }[]; locations?: string[] }): T[] {
  const fixed = autoFixStoryboard(shots as RawShotLike[], ctx) as T[]
  return mergeGeneratedWithLocked(fixed, locked)
}
