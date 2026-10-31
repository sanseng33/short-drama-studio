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
import { autoFixStoryboard, repairPrompt, validateStoryboard, type RawShotLike, type StoryboardIssue } from './generatorRules'

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
}

export async function generateStoryboardChecked(
  llm: Llm,
  p: Project,
  o: EpisodeOutline,
  scriptText: string,
  opts: { maxRepairs?: number; extraFeedback?: string[] } = {},
): Promise<StoryboardResult> {
  const ctx = { characters: p.characters, locations: p.locations, secondsPerEp: p.secondsPerEp }
  const base = storyboardUser(p, o, scriptText) + (opts.extraFeedback?.length ? `\n【上次导出的闸门反馈，必须修正】\n${opts.extraFeedback.map((x) => `- ${x}`).join('\n')}` : '')
  let best: { raw: RawShotLike[]; issues: StoryboardIssue[] } | null = null
  let user = base
  let attempts = 0
  for (let k = 0; k <= (opts.maxRepairs ?? 2); k++) {
    attempts++
    let raw: RawShotLike[]
    try {
      raw = autoFixStoryboard(parseJsonArray<RawShotLike>(await llm(STORYBOARD_SYSTEM, user, k ? 0.4 : 0.7)), ctx)
    } catch (e) {
      user = `${base}\n\n上一次输出无法解析为 JSON 数组（${(e as Error).message}）。只输出一个合法 JSON 数组。`
      continue
    }
    const issues = validateStoryboard(raw, ctx)
    if (!best || issues.length < best.issues.length) best = { raw, issues }
    if (!issues.length) break
    user = `${base}\n\n【上一版输出】\n${JSON.stringify(raw)}\n\n${repairPrompt(issues)}`
  }
  if (!best) throw new Error(`storyboard ep${o.episode}: no parseable output`)
  return { shots: normalizeLlmShots(best.raw as unknown as Parameters<typeof normalizeLlmShots>[0], o.episode, p.characters), issues: best.issues, attempts }
}
