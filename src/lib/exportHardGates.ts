/**
 * Hard export gates that are not accept-risk dialogue findings:
 *   - bound start-frame still vs shot prose (décor / size / camera / staging)
 *   - in-scene décor anchors that contradict one another
 * Pipeline JSON is blocked; markdown / seedance warn.
 */
import type { Project } from '../types'
import { evaluateStartFrameConsistency, formatStartFrameConflicts } from './startFrameStill'
import { validateContinuity, type RawShotLike } from './generatorRules'
import { locationNamer } from './locationNorm'

export type ExportHardCode = 'start_frame_conflict' | 'scene_decor_conflict'

export interface ExportHardIssue {
  code: ExportHardCode
  episode: number
  shotId: string
  message: string
}

export function collectExportHardIssues(project: Project): ExportHardIssue[] {
  const out: ExportHardIssue[] = []
  const sf = evaluateStartFrameConsistency(project)
  if (!sf.ok) {
    for (const c of sf.conflicts) {
      out.push({
        code: 'start_frame_conflict',
        episode: c.episode || 0,
        shotId: c.shotId,
        message: formatStartFrameConflicts([c])[0],
      })
    }
  }
  const namer = locationNamer(project.characters)
  for (const [k, shots] of Object.entries(project.storyboards || {})) {
    const episode = Number(k)
    if (!shots?.length) continue
    for (const issue of validateContinuity(shots as RawShotLike[], namer)) {
      if (issue.rule !== 'sceneDecor') continue
      const shot = issue.shot ? shots[issue.shot - 1] : undefined
      out.push({
        code: 'scene_decor_conflict',
        episode: Number.isFinite(episode) ? episode : 0,
        shotId: shot?.id || (issue.shot ? `shot-${issue.shot}` : ''),
        message: `第${episode}集${issue.shot ? `第${issue.shot}镜` : ''}：${issue.detail}`,
      })
    }
  }
  return out
}

export function evaluateExportHardGates(project: Project): { ok: boolean; issues: ExportHardIssue[] } {
  const issues = collectExportHardIssues(project)
  return { ok: !issues.length, issues }
}

export function formatExportHardIssues(issues: ExportHardIssue[]): string {
  if (!issues.length) return ''
  return ['## 导出警告', '', ...issues.map((i) => `- ${i.message}`), ''].join('\n')
}

export interface EpisodeDurationWarning {
  episode: number
  seconds: number
  secondsPerEp: number
  code: 'episode_duration_mismatch'
  message: string
}

/** Warn when an episode total is not equal to secondsPerEp (does not block; +5 cap still applies in validateStoryboard). */
export function collectEpisodeDurationWarnings(
  project: { secondsPerEp?: number; storyboards?: Record<string | number, Array<{ durationSec?: number }>> },
  shots?: Array<{ episode: number; durationSec?: number }>,
): EpisodeDurationWarning[] {
  const cap = Number(project.secondsPerEp) || 0
  if (cap <= 0) return []
  const byEp = new Map<number, number>()
  if (shots?.length) {
    for (const s of shots) byEp.set(s.episode, (byEp.get(s.episode) || 0) + (Number(s.durationSec) || 0))
  } else {
    for (const [k, arr] of Object.entries(project.storyboards || {})) {
      const episode = Number(k)
      const seconds = (arr || []).reduce((a, s) => a + (Number(s.durationSec) || 0), 0)
      byEp.set(episode, seconds)
    }
  }
  const out: EpisodeDurationWarning[] = []
  for (const [episode, seconds] of byEp) {
    if (Math.abs(seconds - cap) >= 0.5) {
      out.push({
        episode,
        seconds: Math.round(seconds * 10) / 10,
        secondsPerEp: cap,
        code: 'episode_duration_mismatch',
        message: `本集时长合计 ${Math.round(seconds * 10) / 10}s，与 secondsPerEp=${cap}s 不一致`,
      })
    }
  }
  return out
}
