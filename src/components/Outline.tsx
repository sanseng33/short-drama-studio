import type { ProjectApi } from '../hooks/useProject'

export function Outline({ api }: { api: ProjectApi }) {
  const { project, setProject, genOutlineTemplate, genOutlineLlm, busy, llm } = api
  const hasKey = Boolean(llm.apiKey.trim())

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">分集大纲</h2>
          <p className="mt-1 text-sm text-ink-muted">
            每集 = 钩子 + 概要 + 悬念。模板引擎离线可用；配置 API Key 后可用 LLM 增强。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={genOutlineTemplate} disabled={busy}>
            模板生成
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={genOutlineLlm}
            disabled={busy || !hasKey}
            title={!hasKey ? '请先在设置中填写 API Key' : ''}
          >
            用 LLM 生成
          </button>
        </div>
      </header>

      {!project.outline.length && (
        <div className="panel p-6 text-center text-sm text-ink-muted">
          尚未生成大纲。点击「模板生成」即可得到 {project.episodeCount} 集骨架。
        </div>
      )}

      <div className="space-y-3">
        {project.outline.map((e, idx) => (
          <div key={e.episode} className="panel p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-accent-soft">EP{String(e.episode).padStart(2, '0')}</span>
              <input
                className="field !py-1 font-medium"
                value={e.title}
                onChange={(ev) => {
                  const title = ev.target.value
                  setProject((p) => {
                    const outline = [...p.outline]
                    outline[idx] = { ...outline[idx], title }
                    return { ...p, outline }
                  })
                }}
              />
              <button
                type="button"
                className="btn-ghost !py-1 text-xs"
                onClick={() => api.update({ selectedEpisode: e.episode })}
              >
                选为当前集
              </button>
            </div>
            <div className="grid gap-2 text-sm">
              <Field
                label="钩子"
                value={e.hook}
                onChange={(hook) =>
                  setProject((p) => {
                    const outline = [...p.outline]
                    outline[idx] = { ...outline[idx], hook }
                    return { ...p, outline }
                  })
                }
              />
              <Field
                label="概要"
                value={e.summary}
                onChange={(summary) =>
                  setProject((p) => {
                    const outline = [...p.outline]
                    outline[idx] = { ...outline[idx], summary }
                    return { ...p, outline }
                  })
                }
              />
              <Field
                label="悬念"
                value={e.cliffhanger}
                onChange={(cliffhanger) =>
                  setProject((p) => {
                    const outline = [...p.outline]
                    outline[idx] = { ...outline[idx], cliffhanger }
                    return { ...p, outline }
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea className="field min-h-[52px]" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
