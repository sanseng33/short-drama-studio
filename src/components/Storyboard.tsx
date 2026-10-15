import type { ProjectApi } from '../hooks/useProject'
import { CopyButton } from './CopyButton'
import { shotCharacterIds } from '../lib/shotCast'
import { buildVideoPipelineExport, videoPipelineFilename } from '../lib/videoExport'
import { downloadText } from '../lib/storage'

export function Storyboard({ api }: { api: ProjectApi }) {
  const {
    project,
    update,
    genStoryboardTemplate,
    genStoryboardLlm,
    busy,
    llm,
    flash,
  } = api
  const hasKey = Boolean(llm.apiKey.trim())
  const ep = project.selectedEpisode
  const shots = project.storyboards[ep] || []
  const chars = project.characters

  const toggleChar = (shotId: string, charId: string) => {
    const next = shots.map((s) => {
      if (s.id !== shotId) return s
      const cur = shotCharacterIds(s, chars)
      const ids = cur.includes(charId) ? cur.filter((x) => x !== charId) : [...cur, charId]
      return { ...s, characterIds: chars.map((c) => c.id).filter((id) => ids.includes(id)) }
    })
    update({ storyboards: { ...project.storyboards, [ep]: next } })
  }

  const exportPipeline = () => {
    const data = buildVideoPipelineExport(project)
    if (!data.shots.length) {
      flash('尚无分镜可导出')
      return
    }
    downloadText(videoPipelineFilename(project), JSON.stringify(data, null, 2), 'application/json')
    flash(`已导出视频流水线 JSON（${data.shots.length} 镜）`)
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">分镜表</h2>
          <p className="mt-1 text-sm text-ink-muted">
            工业字段：镜号 / 景别 / 时长 / 画面 / 动作 / 台词 / 运镜 / 情绪 / Seedance。相邻同场景合并为镜头组备注。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="field !w-auto"
            value={ep}
            onChange={(e) => update({ selectedEpisode: Number(e.target.value) })}
          >
            {Array.from({ length: Math.max(project.episodeCount, 1) }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                第 {i + 1} 集
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={genStoryboardTemplate} disabled={busy}>
            模板生成
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={genStoryboardLlm}
            disabled={busy || !hasKey}
          >
            用 LLM 生成
          </button>
          <button type="button" className="btn-ghost" onClick={exportPipeline}>
            导出给视频流水线
          </button>
        </div>
      </header>

      {!shots.length && (
        <div className="panel p-6 text-center text-sm text-ink-muted">
          尚未生成本集分镜。模板会自动补剧本（若缺失）并产出 Seedance 提示词。
        </div>
      )}

      <div className="space-y-3">
        {shots.map((s) => (
          <div key={s.id} className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-surface-700 bg-surface-850/60 px-4 py-2">
              <span className="font-mono text-sm text-accent-soft">#{s.shotNo}</span>
              <span className="rounded bg-surface-700 px-2 py-0.5 text-xs">{s.size}</span>
              <span className="rounded bg-surface-700 px-2 py-0.5 text-xs">{s.durationSec}s</span>
              <span className="rounded bg-surface-700 px-2 py-0.5 text-xs">{s.camera}</span>
              <span className="text-xs text-ink-faint">{s.emotion}</span>
              {s.groupNote && (
                <span className="ml-auto text-[11px] text-amber-200/80">{s.groupNote}</span>
              )}
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <div className="label">
                  出场角色{s.characterIds === undefined && <span className="ml-1 text-ink-faint">（自动识别）</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {chars.map((c) => {
                    const on = shotCharacterIds(s, chars).includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleChar(s.id, c.id)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                          on
                            ? 'border-accent bg-accent/20 text-accent-soft'
                            : 'border-surface-700 text-ink-faint hover:text-ink-muted'
                        }`}
                        title={c.role}
                      >
                        {c.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <div className="label">画面</div>
                <p className="text-sm">{s.visual}</p>
              </div>
              <div>
                <div className="label">动作</div>
                <p className="text-sm">{s.action}</p>
              </div>
              {s.dialogue && (
                <div className="sm:col-span-2">
                  <div className="label">台词</div>
                  <p className="font-mono text-xs text-ink-muted">{s.dialogue}</p>
                </div>
              )}
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <div className="label !mb-0">Seedance 提示词</div>
                  <CopyButton text={s.seedancePrompt} />
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-surface-950 p-3 font-mono text-[11px] leading-relaxed text-ink-muted">
                  {s.seedancePrompt}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
