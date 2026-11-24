import { useState, type ReactNode } from 'react'
import type { ProjectApi } from '../hooks/useProject'
import { downloadText } from '../lib/storage'
import { formatMissingLine, type FindingMeta } from '../lib/consistency/exportWarnings'
import {
  allPendingChecked,
  attemptPipelineExport,
  confirmAcceptAndExport,
  pendingKey,
} from '../lib/consistency/pipelineExportGate'

/** 分镜页与导出页共用：「导出给视频流水线」的闸门状态与确认面板。 */
export function usePipelineExportGate(api: Pick<ProjectApi, 'project' | 'setProject' | 'flash'>): {
  requestExport: () => void
  gatePanel: ReactNode
} {
  const { project, setProject, flash } = api
  const [gateOpen, setGateOpen] = useState(false)
  const [pending, setPending] = useState<FindingMeta[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  const deps = { download: downloadText, flash, setProject }
  const allChecked = allPendingChecked(pending, checked)

  const close = () => {
    setGateOpen(false)
    setPending([])
    setChecked({})
  }

  const requestExport = () => {
    const r = attemptPipelineExport(project, deps)
    if (r.status === 'blocked') {
      setPending(r.pending)
      setChecked({})
      setGateOpen(true)
    }
  }

  const confirm = () => {
    const r = confirmAcceptAndExport(project, pending, checked, deps)
    if (r.status !== 'not_confirmed') close()
  }

  const gatePanel = gateOpen ? (
    <div className="panel max-h-[70vh] space-y-3 overflow-y-auto break-words border border-amber-500/40 p-4 text-sm">
      <h3 className="font-medium">下载视频流水线 JSON 前需接受确定缺词风险</h3>
      <p className="text-xs text-ink-muted">
        下列台词在分镜中确定缺失。请逐条勾选确认后才能下载。此操作不会改写剧本或分镜对白。
      </p>
      <ul className="space-y-2">
        {pending.map((f) => {
          const key = pendingKey(f)
          return (
            <li key={key}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={!!checked[key]}
                  onChange={(e) => setChecked((c) => ({ ...c, [key]: e.target.checked }))}
                />
                <span className="min-w-0 break-words">{formatMissingLine(f)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap gap-2 rounded-b-xl border-t border-surface-700 bg-surface-900 px-4 py-3">
        <button type="button" className="btn-primary" disabled={!allChecked} onClick={confirm}>
          确认接受并下载
        </button>
        <button type="button" className="btn-ghost" onClick={close}>
          取消
        </button>
      </div>
    </div>
  ) : null

  return { requestExport, gatePanel }
}
