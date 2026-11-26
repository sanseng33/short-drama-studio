/**
 * PK-07：锁定剧本的生产决策与更新函数。ScriptPanel、useProject、IdeaPanel 共用，测试直接调用本文件。
 * 不自动删除或改写台词；锁定集的剧本原稿与已有分镜在覆盖前后保持原样。
 */
import type { EpisodeScript, Project, Shot } from '../../types'
import { generateScript } from '../templates'
import { applyDialogueAuditToProject } from './collect'
import { isScriptLocked, overwriteLockedScriptMessage } from './factLocks'
import { refreshStale } from './stale'
import { isEpisodeStoryboardLocked } from './storyboardLocks'

export interface ScriptGenOpts {
  confirmOverwrite?: boolean
}

/** 剧本已锁定且尚未确认覆盖时，生成必须保持原项目。 */
export function isScriptOverwriteBlocked(project: Project, episode: number, opts?: ScriptGenOpts): boolean {
  return isScriptLocked(project, episode) && !opts?.confirmOverwrite
}

/**
 * ScriptPanel 点击生成前的决策：已锁定时用 confirm 询问；取消返回 proceed:false（调用方不得调用生成）。
 * 确认后返回 { confirmOverwrite: true }。
 */
export function decideScriptGeneration(
  project: Project,
  episode: number,
  confirm: (message: string) => boolean,
): { proceed: false } | { proceed: true; opts?: ScriptGenOpts } {
  if (!isScriptLocked(project, episode)) return { proceed: true }
  if (!confirm(overwriteLockedScriptMessage(episode))) return { proceed: false }
  return { proceed: true, opts: { confirmOverwrite: true } }
}

export type ScriptTemplateStatus = 'ok' | 'no_cast' | 'no_outline' | 'locked'

/** 模板生成当前集剧本。未通过前置条件或被锁稿拦截时返回原项目对象。 */
export function applyScriptTemplate(
  p: Project,
  opts?: ScriptGenOpts,
): { project: Project; status: ScriptTemplateStatus } {
  if (!p.characters.length) return { project: p, status: 'no_cast' }
  const ep = p.selectedEpisode
  const outline = p.outline.find((o) => o.episode === ep)
  if (!outline) return { project: p, status: 'no_outline' }
  if (isScriptOverwriteBlocked(p, ep, opts)) return { project: p, status: 'locked' }
  const script = generateScript(p.genre, ep, outline, p.characters, p.secondsPerEp)
  return { project: refreshStale({ ...p, scripts: { ...p.scripts, [ep]: script } }), status: 'ok' }
}

/** LLM 返回剧本全文后写入指定集（调用方须已通过 isScriptOverwriteBlocked 检查）。 */
export function applyLlmScript(prev: Project, episode: number, title: string, text: string): Project {
  return refreshStale({
    ...prev,
    scripts: {
      ...prev.scripts,
      [episode]: { episode, title, beats: [{ label: '全文', content: text }], fullText: text },
    },
  })
}

/** 一键生成：从上一版项目收集已锁定集的剧本原稿与已有分镜。 */
export function collectLockedKeeps(prev: Project): {
  scripts: Record<number, EpisodeScript>
  storyboards: Record<number, Shot[]>
  episodes: number[]
} {
  const scripts: Record<number, EpisodeScript> = {}
  const storyboards: Record<number, Shot[]> = {}
  const episodes: number[] = []
  for (const [k, script] of Object.entries(prev.scripts || {})) {
    const ep = Number(k)
    if (!Number.isFinite(ep) || !isScriptLocked(prev, ep) || !script) continue
    scripts[ep] = script
    episodes.push(ep)
    if (prev.storyboards?.[ep]?.length) storyboards[ep] = prev.storyboards[ep]
  }
  episodes.sort((a, b) => a - b)
  return { scripts, storyboards, episodes }
}

/** 一键生成的剧本步：锁定集保留原稿（kept:true），未锁定集写入 makeScript() 的结果。 */
export function applyOneClickScript(
  prev: Project,
  proj: Project,
  episode: number,
  makeScript: () => EpisodeScript,
): { project: Project; kept: boolean } {
  if (isScriptLocked(prev, episode) && proj.scripts[episode]) return { project: proj, kept: true }
  return { project: { ...proj, scripts: { ...proj.scripts, [episode]: makeScript() } }, kept: false }
}

/** 一键生成的分镜步：锁定集保留已有分镜并只重新审计；其余写入 makeShots() 后审计。 */
export function applyOneClickStoryboard(
  prev: Project,
  proj: Project,
  episode: number,
  makeShots: () => Shot[],
): { project: Project; kept: boolean } {
  if ((isScriptLocked(prev, episode) || isEpisodeStoryboardLocked(prev, episode) || isEpisodeStoryboardLocked(proj, episode)) && proj.storyboards[episode]?.length) {
    return { project: applyDialogueAuditToProject(proj, episode), kept: true }
  }
  const shots = makeShots()
  return {
    project: applyDialogueAuditToProject({ ...proj, storyboards: { ...proj.storyboards, [episode]: shots } }, episode),
    kept: false,
  }
}
