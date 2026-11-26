/**
 * PK-06：视频流水线 JSON 导出闸门的共用实现（ExportPanel 与 Storyboard 同用）。
 * 只拦「导出给视频流水线」；项目 JSON / Markdown / Seedance 不经过此处。
 * 不改写剧本或分镜对白，不改 videoExport.ts。副作用（下载、提示、写项目）由调用方注入，便于测试。
 */
import type { Project } from '../../types'
import { evaluateExportHardGates, type ExportHardIssue } from '../exportHardGates'
import { buildVideoPipelineExport, videoPipelineFilename } from '../videoExport'
import {
  acceptRisksForFindings,
  isPipelineJsonBlocked,
  unacceptedDefiniteMissing,
  type FindingMeta,
} from './exportWarnings'

export const PIPELINE_ACCEPT_NOTE = '用户在导出视频流水线 JSON 时确认接受确定缺词风险'
export const PIPELINE_EMPTY_MESSAGE = '尚无分镜可导出'

export interface PipelineExportDeps {
  download: (filename: string, content: string, mime?: string) => void
  flash: (msg: string) => void
  setProject: (next: Project) => void
}

export type PipelineExportAttempt =
  | { status: 'empty' }
  | { status: 'blocked'; pending: FindingMeta[] }
  | { status: 'blocked_consistency'; issues: ExportHardIssue[] }
  | { status: 'downloaded'; shots: number }

export type PipelineConfirmResult =
  | { status: 'not_confirmed' }
  | { status: 'empty' }
  | { status: 'downloaded'; shots: number; project: Project }

export function pendingKey(f: FindingMeta): string {
  return f.targetKey || f.id
}

export function allPendingChecked(pending: FindingMeta[], checked: Record<string, boolean>): boolean {
  return pending.length > 0 && pending.every((f) => !!checked[pendingKey(f)])
}

function downloadPipeline(project: Project, deps: PipelineExportDeps): PipelineExportAttempt {
  const data = buildVideoPipelineExport(project)
  if (!data.shots.length) {
    deps.flash(PIPELINE_EMPTY_MESSAGE)
    return { status: 'empty' }
  }
  deps.download(videoPipelineFilename(project), JSON.stringify(data, null, 2), 'application/json')
  deps.flash(`已导出视频流水线 JSON（${data.shots.length} 镜）`)
  return { status: 'downloaded', shots: data.shots.length }
}

/** 点击「导出给视频流水线」：无分镜提示；有未接受确定缺词则拦截并返回待确认列表；否则直接下载。 */
export function attemptPipelineExport(project: Project, deps: PipelineExportDeps): PipelineExportAttempt {
  const data = buildVideoPipelineExport(project)
  if (!data.shots.length) {
    deps.flash(PIPELINE_EMPTY_MESSAGE)
    return { status: 'empty' }
  }
  const hard = evaluateExportHardGates(project)
  if (!hard.ok) {
    return { status: 'blocked_consistency', issues: hard.issues }
  }
  if (isPipelineJsonBlocked(project)) {
    return { status: 'blocked', pending: unacceptedDefiniteMissing(project) }
  }
  return downloadPipeline(project, deps)
}

/** 「确认接受并下载」：须全部勾选；先写入 acceptedRisks，再下载。取消无需调用本函数（不产生任何副作用）。 */
export function confirmAcceptAndExport(
  project: Project,
  pending: FindingMeta[],
  checked: Record<string, boolean>,
  deps: PipelineExportDeps,
): PipelineConfirmResult {
  if (!allPendingChecked(pending, checked)) return { status: 'not_confirmed' }
  const next = acceptRisksForFindings(project, pending, PIPELINE_ACCEPT_NOTE)
  deps.setProject(next)
  const r = downloadPipeline(next, deps)
  if (r.status !== 'downloaded') return { status: 'empty' }
  return { status: 'downloaded', shots: r.shots, project: next }
}
