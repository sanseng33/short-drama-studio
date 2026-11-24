import type { CheckFinding } from '../lib/consistency/types'
import { EXPORT_WARNINGS_EMPTY } from '../lib/consistency/exportWarnings'

const TONE: Record<string, string> = {
  error: 'text-red-200',
  warning: 'text-amber-200',
  info: 'text-ink-muted',
}

export function ConsistencyFindings({
  title,
  findings,
  emptyText,
  badge,
  onIgnore,
}: {
  title: string
  findings: CheckFinding[]
  emptyText?: string
  badge?: string | null
  onIgnore?: (finding: CheckFinding) => void
}) {
  const empty = emptyText ?? EXPORT_WARNINGS_EMPTY
  return (
    <div className="panel space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {badge ? <span className="text-xs text-amber-200">{badge}</span> : null}
      </div>
      {findings.length === 0 ? (
        <p className="text-xs text-ink-muted">{empty}</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {findings.map((f) => {
            const ext = f as CheckFinding & { lineText?: string; accepted?: boolean; occurrence?: number }
            return (
              <li key={f.id || `${f.code}-${f.episode}-${f.message}`} className={TONE[f.severity] || TONE.info}>
                <span className="font-mono">{f.code}</span>
                {ext.accepted ? '（已接受）' : ''}
                {ext.lineText || f.message ? ` · ${ext.lineText || f.message}` : ''}
                {ext.occurrence && ext.occurrence > 1 ? `（第 ${ext.occurrence} 次出现）` : ''}
                {f.evidence ? ` — ${f.evidence}` : ''}
                {f.episode ? ` · 第${f.episode}集` : ''}
                {onIgnore && f.targetKey ? (
                  <button type="button" className="btn-ghost ml-2 !py-0.5 text-[10px]" onClick={() => onIgnore(f)}>
                    忽略
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
