import type { ProjectApi } from '../hooks/useProject'
import { CopyButton } from './CopyButton'

export function ScriptPanel({ api }: { api: ProjectApi }) {
  const {
    project,
    update,
    genScriptTemplate,
    genScriptLlm,
    busy,
    llm,
  } = api
  const hasKey = Boolean(llm.apiKey.trim())
  const ep = project.selectedEpisode
  const script = project.scripts[ep]
  const outline = project.outline.find((o) => o.episode === ep)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">分集剧本</h2>
          <p className="mt-1 text-sm text-ink-muted">
            结构：3秒钩子 → 冲突 → 反转 → 情绪高点 → 结尾悬念。适合 {project.secondsPerEp}s 竖屏。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-muted">当前集</label>
          <select
            className="field !w-auto"
            value={ep}
            onChange={(e) => update({ selectedEpisode: Number(e.target.value) })}
          >
            {Array.from({ length: Math.max(project.episodeCount, project.outline.length || 1) }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                第 {i + 1} 集{project.outline[i] ? ` · ${project.outline[i].title}` : ''}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={genScriptTemplate} disabled={busy}>
            模板生成
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={genScriptLlm}
            disabled={busy || !hasKey}
          >
            用 LLM 生成
          </button>
        </div>
      </header>

      {!outline && (
        <div className="panel p-4 text-sm text-amber-300/90">请先在「大纲」步骤生成分集大纲。</div>
      )}

      {outline && (
        <div className="panel p-3 text-xs text-ink-muted">
          <span className="text-accent-soft">本集钩子：</span> {outline.hook}
          <span className="mx-2">·</span>
          <span className="text-accent-soft">悬念：</span> {outline.cliffhanger}
        </div>
      )}

      {!script && (
        <div className="panel p-6 text-center text-sm text-ink-muted">
          尚未生成本集剧本。无 API Key 也可点「模板生成」。
        </div>
      )}

      {script && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">
              第{script.episode}集《{script.title}》
            </h3>
            <CopyButton text={script.fullText} label="复制全文" />
          </div>
          {script.beats.map((b, i) => (
            <div key={i} className="panel p-4">
              <div className="mb-1 text-xs font-semibold text-accent-soft">{b.label}</div>
              <p className="text-sm leading-relaxed">{b.content}</p>
              {b.dialogue && (
                <p className="mt-2 rounded-lg bg-surface-850 px-3 py-2 font-mono text-xs text-ink-muted">
                  {b.dialogue}
                </p>
              )}
            </div>
          ))}
          <details className="panel p-3">
            <summary className="cursor-pointer text-sm text-ink-muted">查看 Markdown 全文</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-ink-muted">{script.fullText}</pre>
          </details>
        </div>
      )}
    </div>
  )
}
