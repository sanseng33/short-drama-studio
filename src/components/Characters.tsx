import type { ProjectApi } from '../hooks/useProject'
import type { Character } from '../types'

export function Characters({ api }: { api: ProjectApi }) {
  const { project, setProject, applyGenreDefaults } = api

  const updateChar = (id: string, patch: Partial<Character>) => {
    setProject((p) => ({
      ...p,
      characters: p.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">角色卡</h2>
          <p className="mt-1 text-sm text-ink-muted">
            视觉锁定描述会写入每条 Seedance 提示词，务必具体（发型/疤痕/瞳色/服装）。
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={applyGenreDefaults}>
          重置为题材默认
        </button>
      </header>

      <div className="space-y-4">
        {project.characters.map((c) => (
          <div key={c.id} className="panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent-soft">
                {c.role}
              </span>
              <input
                className="field !w-auto min-w-[8rem] font-medium"
                value={c.name}
                onChange={(e) => updateChar(c.id, { name: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">视觉锁定</label>
                <textarea
                  className="field min-h-[72px]"
                  value={c.visualLock}
                  onChange={(e) => updateChar(c.id, { visualLock: e.target.value })}
                />
              </div>
              <div>
                <label className="label">服装</label>
                <textarea
                  className="field min-h-[56px]"
                  value={c.costume}
                  onChange={(e) => updateChar(c.id, { costume: e.target.value })}
                />
              </div>
              <div>
                <label className="label">标志道具</label>
                <input
                  className="field"
                  value={c.signatureProp}
                  onChange={(e) => updateChar(c.id, { signatureProp: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">定位 / 角色</label>
                <input
                  className="field"
                  value={c.role}
                  onChange={(e) => updateChar(c.id, { role: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
