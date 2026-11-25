import { useMemo, useRef, useState } from 'react'
import type { ProjectApi } from '../hooks/useProject'
import { projectToMarkdown, seedancePack } from '../lib/export'
import { downloadText } from '../lib/storage'
import { buildVideoPipelineExport } from '../lib/videoExport'
import {
  DEFAULT_IMPORT_LIMITS,
  type ProjectImportPreview,
} from '../lib/projectImport'
import {
  EXPORT_WARNINGS_EMPTY,
  dialogueReviewLabel,
  liveDialogueFindings,
  mapExportWarnings,
} from '../lib/consistency/exportWarnings'
import { CopyButton } from './CopyButton'
import { ConsistencyFindings } from './ConsistencyFindings'
import { usePipelineExportGate } from './PipelineExportGate'

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <span className="text-ink-faint">{label}</span>
      <span className="min-w-0 break-all">{value || '（空）'}</span>
    </div>
  )
}

export function ExportPanel({ api }: { api: ProjectApi }) {
  const { project, flash, setError, previewProjectImport, commitProjectImport } = api
  const md = projectToMarkdown(project)
  const pack = seedancePack(project, project.selectedEpisode)
  const packAll = seedancePack(project)
  const pipeline = useMemo(() => buildVideoPipelineExport(project), [project])
  const exportFindings = useMemo(() => mapExportWarnings(pipeline.warnings), [pipeline])
  const dialogueFindings = useMemo(() => liveDialogueFindings(project), [project])
  const reviewBadge = useMemo(() => dialogueReviewLabel(project), [project])
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ raw: string; preview: ProjectImportPreview; fileName: string } | null>(
    null,
  )
  const [importError, setImportError] = useState('')

  const { requestExport, gatePanel } = usePipelineExportGate(api)

  const onPickImport = async (file: File | null) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setImportError('')
    if (file.size > DEFAULT_IMPORT_LIMITS.maxBytes) {
      setPending(null)
      setImportError('文件过大，已拒绝导入；当前工程未被修改。')
      return
    }
    try {
      const raw = await file.text()
      const parsed = previewProjectImport(raw)
      if (!parsed.ok) {
        setPending(null)
        setImportError(parsed.message)
        return
      }
      setPending({ raw, preview: parsed.preview, fileName: file.name })
    } catch {
      setPending(null)
      setImportError('无法读取该文件，已拒绝导入；当前工程未被修改。')
    }
  }

  const cancelImport = () => {
    setPending(null)
    setImportError('')
  }

  const confirmImport = () => {
    if (!pending) return
    const result = commitProjectImport(pending.raw)
    if (!result.ok) {
      setImportError(result.message)
      return
    }
    setPending(null)
    setImportError('')
    setError('')
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">导出</h2>
        <p className="mt-1 text-sm text-ink-muted">
          下载 Markdown 项目手册、项目 JSON、以及可直接粘贴到 Seedance / 即梦的提示词包。也可导入此前下载的项目 JSON（会先备份当前工程并请你确认）。
        </p>
      </header>

      <ConsistencyFindings title="既有导出警告" findings={exportFindings} emptyText={EXPORT_WARNINGS_EMPTY} />
      <ConsistencyFindings
        title="台词检查"
        findings={dialogueFindings}
        emptyText="当前没有台词检查项。"
        badge={reviewBadge}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
          导入 JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void onPickImport(e.target.files?.[0] ?? null)}
        />
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

      {importError && (
        <div className="panel border-red-500/40 p-3 text-sm text-red-300">{importError}</div>
      )}

      {pending && (
        <div className="panel border-accent/40 space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-accent-soft">确认导入项目 JSON</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                {pending.fileName} · 导入将先备份当前工程，再覆盖为下列项目。此操作不会改动设置中的 LLM 密钥。取消则不做任何修改。
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost !py-1 text-xs" onClick={cancelImport}>
                取消
              </button>
              <button type="button" className="btn-primary !py-1 text-xs" onClick={confirmImport}>
                确认导入
              </button>
            </div>
          </div>
          <div className="space-y-1 text-ink">
            <PreviewRow label="标题" value={pending.preview.title} />
            <PreviewRow label="id" value={pending.preview.id} />
            <PreviewRow
              label="schemaVersion"
              value={pending.preview.schemaVersion == null ? '（缺省）' : String(pending.preview.schemaVersion)}
            />
            <PreviewRow label="更新时间" value={pending.preview.updatedAt} />
            <PreviewRow label="集数" value={String(pending.preview.episodeCount)} />
            <PreviewRow label="当前集" value={String(pending.preview.selectedEpisode)} />
            <PreviewRow label="角色数" value={String(pending.preview.characterCount)} />
            <PreviewRow label="已有剧本" value={pending.preview.hasScripts ? '是' : '否'} />
            <PreviewRow label="已有分镜" value={pending.preview.hasStoryboards ? '是' : '否'} />
            {pending.preview.sourceMode ? <PreviewRow label="来源" value={pending.preview.sourceMode} /> : null}
          </div>
        </div>
      )}

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

      <button type="button" className="btn-primary ml-3" onClick={requestExport}>
        导出给视频流水线
      </button>

      {gatePanel}

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
