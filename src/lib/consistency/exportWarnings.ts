/** PK-06：把既有导出 warnings 映射为检查项，并判定流水线 JSON 是否需接受风险。不改 videoExport.ts。 */
import type { Project } from '../../types'
import type { VideoPipelineWarning } from '../videoExport'
import { auditEpisodeDialogue, hasDefiniteMissing, type AuditEpisodeResult } from '../dialogueAudit'
import type { AcceptedRisk, CheckFinding } from './types'

export const EXPORT_WARNINGS_EMPTY = '暂无导出警告'
export const REVIEW_LABEL = '待人工复核'
/** 闸门只作用于下载视频流水线 JSON；Markdown / Seedance 不受影响。 */
export const PIPELINE_GATE_TARGET = 'video-pipeline-json' as const

export type FindingMeta = CheckFinding & { lineText?: string; occurrence?: number; accepted?: boolean }

export function mapExportWarnings(warnings: VideoPipelineWarning[] | undefined | null): CheckFinding[] {
  if (!warnings?.length) return []
  return warnings.map((w, i) => ({
    id: `export-${w.code}-${w.episode}-${w.shotId || w.characterId || i}`,
    code: w.code,
    severity: 'warning' as const,
    episode: w.episode || undefined,
    shotId: w.shotId,
    characterId: w.characterId,
    message: w.message,
    confidence: 'unknown' as const,
  }))
}

export function episodesToAudit(project: Project): number[] {
  const s = new Set<number>()
  for (const k of Object.keys(project.scripts || {})) {
    const n = Number(k)
    if (Number.isFinite(n)) s.add(n)
  }
  for (const k of Object.keys(project.storyboards || {})) {
    const n = Number(k)
    if (Number.isFinite(n)) s.add(n)
  }
  return [...s].sort((a, b) => a - b)
}

export function liveAuditProject(project: Project): { episode: number; result: AuditEpisodeResult }[] {
  return episodesToAudit(project).map((episode) => ({
    episode,
    result: auditEpisodeDialogue(
      project.scripts?.[episode],
      project.storyboards?.[episode] || [],
      project.characters,
      project.acceptedRisks,
      { episode },
    ),
  }))
}

export function liveDialogueFindings(project: Project): FindingMeta[] {
  const out: FindingMeta[] = []
  for (const { result } of liveAuditProject(project)) {
    out.push(...(result.findings as FindingMeta[]))
  }
  return out
}

/** 现场重算：未接受的确定缺词（含 dialogue_dropped_silent）。 */
export function unacceptedDefiniteMissing(project: Project): FindingMeta[] {
  const out: FindingMeta[] = []
  for (const { result } of liveAuditProject(project)) {
    out.push(...(result.definiteMissing as FindingMeta[]))
  }
  return out
}

export function isPipelineJsonBlocked(project: Project): boolean {
  for (const { result, episode } of liveAuditProject(project)) {
    if (hasDefiniteMissing(result.findings, project.acceptedRisks, episode)) return true
  }
  return unacceptedDefiniteMissing(project).length > 0
}

export function dialogueReviewLabel(project: Project): string | null {
  const audits = liveAuditProject(project)
  const needsReview = audits.some(
    ({ result }) =>
      result.status === 'unparseable' ||
      result.findings.some(
        (f) =>
          f.confidence === 'fuzzy' ||
          f.confidence === 'unknown' ||
          f.code === 'dialogue_unparseable' ||
          f.code === 'dialogue_review',
      ),
  )
  return needsReview ? REVIEW_LABEL : null
}

export function formatMissingLine(f: FindingMeta): string {
  const text = (f.lineText || f.message || '').trim() || '（无原文）'
  const occ = f.occurrence || 1
  const ep = f.episode ? `第${f.episode}集 · ` : ''
  return `${ep}${text}（第 ${occ} 次出现）`
}

export function acceptRisksForFindings(
  project: Project,
  findings: FindingMeta[],
  note: string,
  at?: string,
): Project {
  const ts = at || new Date().toISOString()
  const existing = Array.isArray(project.acceptedRisks) ? project.acceptedRisks : []
  const keys = new Set(existing.map((r) => r.targetKey).filter(Boolean))
  const added: AcceptedRisk[] = []
  for (const f of findings) {
    const risk: AcceptedRisk = {
      code: f.code,
      episode: f.episode,
      targetKey: f.targetKey,
      note,
      at: ts,
    }
    if (risk.targetKey && keys.has(risk.targetKey)) continue
    if (risk.targetKey) keys.add(risk.targetKey)
    added.push(risk)
  }
  return { ...project, acceptedRisks: [...existing, ...added] }
}
