import type { ProjectApi } from '../hooks/useProject'
import type { Character } from '../types'
import {
  CAST_PRESETS,
  CAST_SOFT_MAX,
  blankCharacter,
  buildPresetCast,
  type CastPresetId,
} from '../lib/templates/cast'

export function Characters({ api }: { api: ProjectApi }) {
  const { project, setProject, applyGenreDefaults, flash } = api

  const updateChar = (id: string, patch: Partial<Character>) => {
    setProject((p) => ({
      ...p,
      characters: p.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  }

  const addChar = () => {
    setProject((p) => {
      if (p.characters.length >= CAST_SOFT_MAX) {
        flash(`角色建议不超过 ${CAST_SOFT_MAX} 个，以免分镜过散`)
        return p
      }
      return { ...p, characters: [...p.characters, blankCharacter(p.characters)] }
    })
  }

  const duplicateChar = (id: string) => {
    setProject((p) => {
      if (p.characters.length >= CAST_SOFT_MAX) {
        flash(`角色建议不超过 ${CAST_SOFT_MAX} 个`)
        return p
      }
      const src = p.characters.find((c) => c.id === id)
      if (!src) return p
      const { id: _id, ...rest } = src
      const copy = blankCharacter(p.characters, {
        ...rest,
        name: `${src.name}（副本）`,
      })
      return { ...p, characters: [...p.characters, copy] }
    })
  }

  const removeChar = (id: string) => {
    setProject((p) => {
      if (p.characters.length <= 1) {
        flash('至少保留 1 个角色')
        return p
      }
      return { ...p, characters: p.characters.filter((c) => c.id !== id) }
    })
  }

  const applyPreset = (id: CastPresetId) => {
    setProject((p) => ({
      ...p,
      characters: buildPresetCast(id, p.characters),
    }))
    flash('已应用阵容预设（可继续增删改）')
  }

  const tagsText = (c: Character) => (c.tags || []).join(', ')

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">角色卡</h2>
          <p className="mt-1 text-sm text-ink-muted">
            角色数量不限死三角：可增删/复制（建议 ≤{CAST_SOFT_MAX}，生成至少 1 人）。
            「定位」可自由填写；「标签」供生成器识别（protagonist / antagonist / mentor / support / romantic 等）。
            题材预设只是起点，不会锁死结构。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={applyGenreDefaults}>
            应用题材预设（可再改）
          </button>
          <button type="button" className="btn-primary" onClick={addChar}>
            添加角色
          </button>
        </div>
      </header>

      <div className="panel p-3">
        <div className="mb-2 text-xs font-medium text-ink-muted">阵容预设（可选）</div>
        <div className="flex flex-wrap gap-2">
          {CAST_PRESETS.map((pr) => (
            <button
              key={pr.id}
              type="button"
              className="btn-ghost !py-1 text-xs"
              title={pr.description}
              onClick={() => applyPreset(pr.id)}
            >
              {pr.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {project.characters.map((c) => (
          <div key={c.id} className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent-soft">
                {c.role || '未命名定位'}
              </span>
              <input
                className="field !w-auto min-w-[8rem] font-medium"
                value={c.name}
                onChange={(e) => updateChar(c.id, { name: e.target.value })}
              />
              <div className="ml-auto flex gap-2">
                <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => duplicateChar(c.id)}>
                  复制
                </button>
                <button type="button" className="btn-ghost !py-1 text-xs text-red-300" onClick={() => removeChar(c.id)}>
                  删除
                </button>
              </div>
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
              <div>
                <label className="label">定位 / 角色（自由填写）</label>
                <input
                  className="field"
                  value={c.role}
                  onChange={(e) => updateChar(c.id, { role: e.target.value })}
                  placeholder="如：主角 / 导师 / 对手 / 情报商"
                />
              </div>
              <div>
                <label className="label">标签 tags（逗号分隔，可选）</label>
                <input
                  className="field"
                  value={tagsText(c)}
                  onChange={(e) =>
                    updateChar(c.id, {
                      tags: e.target.value
                        .split(/[,，\s]+/)
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="protagonist, antagonist, mentor…"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
