import { STEPS, type StepId } from '../types'

export function Sidebar({
  step,
  onStep,
  title,
  onNew,
  onSample,
}: {
  step: StepId
  onStep: (s: StepId) => void
  title: string
  onNew: () => void
  onSample: () => void
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-surface-700 bg-surface-900/90">
      <div className="border-b border-surface-700 px-4 py-4">
        <div className="text-xs font-semibold tracking-widest text-accent-soft">AI 漫剧工作室</div>
        <div className="mt-1 truncate text-sm text-ink-muted" title={title}>
          {title || '未命名'}
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onStep(s.id)}
            className={`flex w-full flex-col rounded-lg px-3 py-2.5 text-left transition ${
              step === s.id
                ? 'bg-accent/20 text-accent-soft'
                : 'text-ink-muted hover:bg-surface-800 hover:text-ink'
            }`}
          >
            <span className="text-sm font-medium">
              <span className="mr-2 font-mono text-xs opacity-60">{i + 1}</span>
              {s.label}
            </span>
            <span className="mt-0.5 pl-5 text-[11px] opacity-70">{s.desc}</span>
          </button>
        ))}
      </nav>
      <div className="space-y-2 border-t border-surface-700 p-3">
        <button type="button" className="btn-ghost w-full" onClick={onNew}>
          新建项目
        </button>
        <button type="button" className="btn-outline w-full" onClick={onSample}>
          加载示例
        </button>
      </div>
    </aside>
  )
}
