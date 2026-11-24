import type { ReactNode } from 'react'
import type { CheckFinding } from '../lib/consistency/types'
import type { DialogueAuditSnapshot } from '../lib/consistency/types'

const TONE: Record<string, string> = {
  error: 'border-red-500/40 bg-red-950/40 text-red-200',
  warning: 'border-amber-500/30 bg-amber-950/30 text-amber-200',
  info: 'border-sky-500/30 bg-surface-800 text-ink-muted',
}

export function FindingsBanner({
  title,
  snapshot,
  onRecheck,
  extra,
}: {
  title?: string
  snapshot?: DialogueAuditSnapshot
  onRecheck?: () => void
  extra?: ReactNode
}) {
  if (!snapshot) return extra ? <>{extra}</> : null
  const findings = snapshot.findings || []
  if (!findings.length && snapshot.status === 'checked') return extra ? <>{extra}</> : null
  const statusLabel: Record<string, string> = {
    checked: '已检查',
    no_script: '无剧本，未对照台词',
    no_storyboard: '尚无分镜',
    unparseable: '存在无法解析的台词，待人工复核',
  }
  return (
    <div className={`panel space-y-2 p-3 text-sm ${snapshot.status === 'unparseable' ? TONE.warning : findings.some((f) => f.severity === 'error' && !(f as CheckFinding & { accepted?: boolean }).accepted) ? TONE.error : TONE.warning}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">
          {title || '台词完整性'}
          <span className="ml-2 text-xs font-normal opacity-80">{statusLabel[snapshot.status] || snapshot.status}</span>
        </div>
        {onRecheck && (
          <button type="button" className="btn-ghost !py-1 text-xs" onClick={onRecheck}>
            重新检查
          </button>
        )}
      </div>
      {findings.length > 0 && (
        <ul className="space-y-1 text-xs">
          {findings.map((f) => {
            const ext = f as CheckFinding & { lineText?: string; accepted?: boolean }
            return (
              <li key={f.id || `${f.code}-${f.message}`} className="break-words">
                <span className="break-all font-mono">{f.code}</span>
                {ext.accepted ? '（已接受）' : ''}
                {ext.lineText || f.message ? ` · ${ext.lineText || f.message}` : ''}
                {f.evidence ? ` — ${f.evidence}` : ''}
              </li>
            )
          })}
        </ul>
      )}
      {extra}
    </div>
  )
}
