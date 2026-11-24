import { useMemo, useState } from 'react'
import type { ProjectApi } from '../hooks/useProject'
import { projectToMarkdown, seedancePack } from '../lib/export'
import { downloadText } from '../lib/storage'
import { buildVideoPipelineExport, videoPipelineFilename } from '../lib/videoExport'
import {
  EXPORT_WARNINGS_EMPTY,
  acceptRisksForFindings,
  dialogueReviewLabel,
  formatMissingLine,
  isPipelineJsonBlocked,
  liveDialogueFindings,
  mapExportWarnings,
  unacceptedDefiniteMissing,
  type FindingMeta,
} from '../lib/consistency/exportWarnings'
import { CopyButton } from './CopyButton'
import { ConsistencyFindings } from './ConsistencyFindings'

const ACCEPT_NOTE = '用户在导出视频流水线 JSON 时确认接受确定缺词风险'

export function ExportPanel({ api }: { api: ProjectApi }) {
  const { project, setProject, flash } = api
  const md = projectToMarkdown(project)
  const pack = seedancePack(project, project.selectedEpisode)
  const packAll = seedancePack(project)
  const pipeline = useMemo(() => buildVideoPipelineExport(project), [project])
  const exportFindings = useMemo(() => mapExportWarnings(pipeline.warnings), [pipeline])
  const dialogueFindings = useMemo(() => liveDialogueFindings(project), [project])
  const reviewBadge = useMemo(() => dialogueReviewLabel(project), [project])

  const [gateOpen, setGateOpen] = useState(false)
  const [pending, setPending] = useState<FindingMeta[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  const allChecked = pending.length > 0 && pending.every((f) => checked[f.targetKey || f.id])

  const downloadPipeline = (fromProject = project) => {
    const data = buildVideoPipelineExport(fromProject)
    if (!data.shots.length) {
      flash('尚无分镜可导出')
      return false
    }
    downloadText(videoPipelineFilename(fromProject), JSON.stringify(data, null, 2), 'application/json')
    flash(`已导出视频流水线 JSON（${data.shots.length} 镜）`)
    return true
  }

  const onExportPipeline = () => {
    const data = buildVideoPipelineExport(project)
    if (!data.shots.length) {
      flash('尚无分镜可导出')
      return
    }
    if (isPipelineJsonBlocked(project)) {
      const items = unacceptedDefiniteMissing(project)
      setPending(items)
      setChecked({})
      setGateOpen(true)
      return
    }
    downloadPipeline()
  }

  const confirmAcceptAndDownload = () => {
    if (!allChecked) return
    const next = acceptRisksForFindings(project, pending, ACCEPT_NOTE)
    setProject(next)
    setGateOpen(false)
    setPending([])
    setChecked({})
    downloadPipeline(next)
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">导出</h2>
        <p className="mt-1 text-sm text-ink-muted">
          下载 Markdown 项目手册、项目 JSON、以及可直接粘贴到 Seedance / 即梦的提示词包。
        </p>
      </header>

      <ConsistencyFindings title="既有导出警告" findings={exportFindings} emptyText={EXPORT_WARNINGS_EMPTY} />
      <ConsistencyFindings
        title="台词检查"
        findings={dialogueFindings}
        emptyText="当前没有台词检查项。"
        badge={reviewBadge}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            downloadText(`${project.title || 'project'}.md`, md, 'text/markdown')
            flash('已下载 Markdown')
          }}
        >
          下载 Markdown
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            downloadText(
              `${project.title || 'project'}.json`,
              JSON.stringify(project, null, 2),
              'application/json',
            )
            flash('已下载 JSON')
          }}
        >
          下载 JSON
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={() => {
            downloadText(
              `${project.title || 'project'}-seedance-ep${project.selectedEpisode}.txt`,
              pack,
            )
            flash('已下载本集 Seedance 包')
          }}
        >
          本集 Seedance 包
        </button>
      </div>

      <button
        type="button"
        className="btn-outline"
        onClick={() => {
          downloadText(`${project.title || 'project'}-seedance-all.txt`, packAll)
          flash('已下载全部已生成分镜的 Seedance 包')
        }}
      >
        下载全部已生成分镜的 Seedance 包
      </button>

      <button type="button" className="btn-primary ml-3" onClick={onExportPipeline}>
        导出给视频流水线
      </button>

      {gateOpen && (
        <div className="panel space-y-3 border border-amber-500/40 p-4 text-sm">
          <h3 className="font-medium">下载视频流水线 JSON 前需接受确定缺词风险</h3>
          <p className="text-xs text-ink-muted">
            下列台词在分镜中确定缺失。请逐条勾选确认后才能下载。此操作不会改写剧本或分镜对白。
          </p>
          <ul className="space-y-2">
            {pending.map((f) => {
              const key = f.targetKey || f.id
              return (
                <li key={key}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={!!checked[key]}
                      onChange={(e) => setChecked((c) => ({ ...c, [key]: e.target.checked }))}
                    />
                    <span>{formatMissingLine(f)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!allChecked}
              onClick={confirmAcceptAndDownload}
            >
              确认接受并下载
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setGateOpen(false)
                setPending([])
                setChecked({})
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="panel p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">本集提示词预览</h3>
          <CopyButton text={pack} label="复制本集包" />
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-muted">
          {pack || '（本集尚无分镜）'}
        </pre>
      </div>
    </div>
  )
}
