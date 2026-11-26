/**
 * Storyboard generation with a self-check / repair loop (shared by the UI one-click flow and scripts/generate.ts):
 * LLM storyboard → generic auto-fix (canonical locations, establishing / carry flags) → validateStoryboard →
 * on issues, re-prompt with the previous output + the issue list (up to maxRepairs) → keep the attempt with the
 * fewest issues. The repack gates remain the final validation of the exported pack.
 */
import type { EpisodeOutline, LlmSettings, Project, Shot } from '../types'
import { chatCompletion, STORYBOARD_SYSTEM } from './llm'
import { storyboardUser } from './prompts'
import { normalizeLlmShots } from './shotCast'
import { fillStructuredShotFields } from './shotState/fillShot'
import { recordShotStates, type ShotStateEpisodeRecord } from './shotState/record'
import { autoFixStoryboard, repairPrompt, validateStoryboard, type RawShotLike, type StoryboardIssue } from './generatorRules'
import { lockConstraintBlock, lockedShotsOf, mergeGeneratedWithLocked } from './consistency/storyboardLocks'

export function parseJsonArray<T = unknown>(text: string): T[] {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const a = t.indexOf('[')
  const b = t.lastIndexOf(']')
  if (a < 0 || b <= a) throw new Error('no JSON array in LLM output')
  return JSON.parse(t.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')) as T[]
}

export type Llm = (system: string, user: string, temperature?: number) => Promise<string>
export const llmOf = (settings: LlmSettings, signal?: AbortSignal): Llm => (system, user, temperature) => chatCompletion(settings, system, user, { signal, temperature })

export interface StoryboardResult {
  shots: Shot[]
  issues: StoryboardIssue[]
  attempts: number
  /** shot-state compat 记录（迁移 + 校验）。只记录：不进入 issues，不影响修复循环与返回的镜头。 */
  shotState?: ShotStateEpisodeRecord
}

export async function generateStoryboardChecked(
  llm: Llm,
  p: Project,
  o: EpisodeOutline,
  scriptText: string,
  opts: { maxRepairs?: number; extraFeedback?: string[] } = {},
): Promise<StoryboardResult> {
  const ctx = { characters: p.characters, locations: p.locations, secondsPerEp: p.secondsPerEp }
  const locked = lockedShotsOf(p, o.episode)
  const lockBlock = lockConstraintBlock(locked)
  const base = storyboardUser(p, o, scriptText) + (opts.extraFeedback?.length ? `\n【上次导出的闸门反馈，必须修正】\n${opts.extraFeedback.map((x) => `- ${x}`).join('\n')}` : '') + (lockBlock ? `\n\n${lockBlock}` : '')
  let best: { raw: RawShotLike[]; issues: StoryboardIssue[] } | null = null
  let user = base
  let attempts = 0
  if (locked.length && (p.storyboards?.[o.episode] || []).length && locked.length === (p.storyboards?.[o.episode] || []).length) {
    const raw = autoFixStoryboard(mergeGeneratedWithLocked([] as RawShotLike[], locked), ctx)
    const restored = mergeGeneratedWithLocked(raw, locked)
    return finishStoryboard(p, o, restored, validateStoryboard(restored, ctx), 0)
  }
  for (let k = 0; k <= (opts.maxRepairs ?? 2); k++) {
    attempts++
    let raw: RawShotLike[]
    try {
      raw = parseJsonArray<RawShotLike>(await llm(STORYBOARD_SYSTEM, user, k ? 0.4 : 0.7))
      raw = autoFixStoryboard(mergeGeneratedWithLocked(raw, locked), ctx)
      raw = mergeGeneratedWithLocked(raw, locked)
    } catch (e) {
      user = `${base}\n\n上一次输出无法解析为 JSON 数组（${(e as Error).message}）。只输出一个合法 JSON 数组。`
      continue
    }
    const issues = validateStoryboard(raw, ctx)
    if (!best || issues.length < best.issues.length) best = { raw, issues }
    if (!issues.length) break
    const unlockedView = locked.length ? raw.filter((s) => !locked.some((l) => (l.id && l.id === (s as { id?: string }).id) || (l.shotNo != null && l.shotNo === (s as { shotNo?: number }).shotNo))) : raw
    user = `${base}\n\n【上一版输出（仅未锁定镜头）】\n${JSON.stringify(unlockedView)}\n\n${repairPrompt(issues, { lockedShots: Boolean(locked.length) })}`
  }
  if (!best) throw new Error(`storyboard ep${o.episode}: no parseable output`)
  return finishStoryboard(p, o, best.raw, best.issues, attempts)
}

function finishStoryboard(p: Project, o: EpisodeOutline, raw: RawShotLike[], issues: StoryboardIssue[], attempts: number): StoryboardResult {
  const locked = lockedShotsOf(p, o.episode)
  const merged = mergeGeneratedWithLocked(raw, locked)
  const shots = fillStructuredShotFields(
    normalizeLlmShots(merged as unknown as Parameters<typeof normalizeLlmShots>[0], o.episode, p.characters),
    p.characters,
    { facts: p.settingFacts },
  )
  // locked bodies win again after normalize/fill
  const lockedNorm = (p.storyboards?.[o.episode] || []).filter((s) => locked.some((l) => l.id === s.id))
  const shotsOut = lockedNorm.length ? mergeGeneratedWithLocked(shots, lockedNorm) : shots
  const result: StoryboardResult = { shots: shotsOut, issues, attempts }
  try {
    result.shotState = recordShotStates(shotsOut, p.characters, { episode: o.episode })
  } catch {
    // 仅限 compat 附加记录：失败等于「无记录」，不是「校验通过」。
    // 不得把这种吞异常用到导出 / run-ready 路径（那里必须抛错或返回 ok:false）。
  }
  return result
}
