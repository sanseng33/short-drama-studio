import type { Project } from '../types'
import { CopyButton } from './CopyButton'

export function Preview({ project }: { project: Project }) {
  const ep = project.selectedEpisode
  const outline = project.outline.find((o) => o.episode === ep)
  const script = project.scripts[ep]
  const shots = project.storyboards[ep] || []
  const firstPrompt = shots[0]?.seedancePrompt || ''

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-surface-700 bg-surface-900/60 xl:flex">
      <div className="border-b border-surface-700 px-4 py-3 text-xs font-semibold tracking-wider text-ink-muted">
        实时预览 · EP{ep}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        <section>
          <div className="label">项目</div>
          <p className="font-medium">{project.title}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {project.genre} · {project.platform} · {project.style}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">{project.logline}</p>
        </section>

        <section>
          <div className="label">角色</div>
          <ul className="space-y-1 text-xs text-ink-muted">
            {project.characters.map((c) => (
              <li key={c.id}>
                <span className="text-ink">{c.name}</span> · {c.role}
              </li>
            ))}
          </ul>
        </section>

        {outline && (
          <section>
            <div className="label">本集大纲</div>
            <p className="text-xs font-medium text-accent-soft">《{outline.title}》</p>
            <p className="mt-1 text-xs text-ink-muted">钩：{outline.hook}</p>
            <p className="mt-1 text-xs text-ink-faint">悬：{outline.cliffhanger}</p>
          </section>
        )}

        {script && (
          <section>
            <div className="label">剧本节拍</div>
            <ul className="space-y-1 text-xs text-ink-muted">
              {script.beats.map((b, i) => (
                <li key={i}>{b.label}</li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="mb-1 flex items-center justify-between">
            <div className="label !mb-0">首镜 Seedance</div>
            {firstPrompt && <CopyButton text={firstPrompt} />}
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-950 p-2 font-mono text-[10px] text-ink-faint">
            {firstPrompt || '生成分镜后显示'}
          </pre>
        </section>

        <section className="text-[11px] text-ink-faint">
          大纲 {project.outline.length} 集 · 剧本{' '}
          {Object.keys(project.scripts).length} · 分镜{' '}
          {Object.keys(project.storyboards).length}
        </section>
      </div>
    </aside>
  )
}
