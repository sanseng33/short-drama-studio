import { useRef, useState } from 'react'
import type { ProjectApi } from '../hooks/useProject'
import type { Character } from '../types'
import {
  CAST_PRESETS,
  CAST_SOFT_MAX,
  blankCharacter,
  buildPresetCast,
  type CastPresetId,
} from '../lib/templates/cast'
import {
  applyCharacterPack,
  buildMatchRows,
  parseCharacterPackJson,
  summarizeTrainingAssets,
  type CharacterPack,
  type PackMatchAction,
  type PackMatchRow,
} from '../lib/characterPack'

type ImportState = {
  pack: CharacterPack
  rows: PackMatchRow[]
  actions: PackMatchAction[]
  fileName: string
}

export function Characters({ api }: { api: ProjectApi }) {
  const { project, setProject, applyGenreDefaults, flash } = api
  const fileRef = useRef<HTMLInputElement>(null)
  const [importState, setImportState] = useState<ImportState | null>(null)

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

  const onPickPack = async (file: File | null) => {
    if (!file) return
    try {
      const text = await file.text()
      const pack = parseCharacterPackJson(text)
      const rows = buildMatchRows(pack, project.characters)
      setImportState({
        pack,
        rows,
        actions: rows.map((r) => r.suggested),
        fileName: file.name,
      })
    } catch (e) {
      flash(e instanceof Error ? e.message : '定妆包读取失败')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const setAction = (index: number, action: PackMatchAction) => {
    setImportState((s) => {
      if (!s) return s
      const actions = [...s.actions]
      actions[index] = action
      return { ...s, actions }
    })
  }

  const confirmImport = () => {
    if (!importState) return
    try {
      const result = applyCharacterPack(project.characters, importState.pack, importState.actions)
      setProject((p) => ({ ...p, characters: result.characters }))
      setImportState(null)
      flash(`定妆包已导入：更新 ${result.updated} · 新建 ${result.created} · 跳过 ${result.skipped}`)
    } catch (e) {
      flash(e instanceof Error ? e.message : '导入失败')
    }
  }

  const actionSelectValue = (a: PackMatchAction): string => {
    if (a.kind === 'skip') return 'skip'
    if (a.kind === 'create') return 'create'
    return `apply:${a.targetId}`
  }

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
          <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
            导入定妆包
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onPickPack(e.target.files?.[0] ?? null)}
          />
          <button type="button" className="btn-primary" onClick={addChar}>
            添加角色
          </button>
        </div>
      </header>

      {importState && (
        <div className="panel border-accent/40 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-accent-soft">确认导入定妆包</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                {importState.fileName}
                {importState.pack.project ? ` · 项目「${importState.pack.project}」` : ''}
                · {importState.pack.characters.length} 个定妆角色
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setImportState(null)}>
                取消
              </button>
              <button type="button" className="btn-primary !py-1 text-xs" onClick={confirmImport}>
                确认导入
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {importState.rows.map((row, i) => {
              const a = importState.actions[i]
              const claimed = new Set(
                importState.actions
                  .map((x, j) => (j !== i && x.kind === 'apply' ? x.targetId : null))
                  .filter(Boolean) as string[],
              )
              return (
                <div
                  key={row.packIndex}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-700 bg-surface-850/60 px-3 py-2 text-sm"
                >
                  <div className="min-w-[10rem] flex-1">
                    <div className="font-medium">{row.pack.displayName}</div>
                    <div className="text-xs text-ink-muted">
                      refImage: {row.pack.refImage}
                      {row.pack.characterKey ? ` · key: ${row.pack.characterKey}` : ''}
                      {row.pack.images?.dir ? ` · dir: ${row.pack.images.dir}` : ''}
                    </div>
                    {summarizeTrainingAssets(row.pack) && (
                      <div className="mt-0.5 text-[11px] text-amber-200/80">{summarizeTrainingAssets(row.pack)}</div>
                    )}
                  </div>
                  <span className="text-xs text-ink-faint">→</span>
                  <select
                    className="field !w-auto min-w-[12rem] !py-1 text-xs"
                    value={actionSelectValue(a)}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === 'skip') setAction(i, { kind: 'skip' })
                      else if (v === 'create') setAction(i, { kind: 'create' })
                      else if (v.startsWith('apply:')) setAction(i, { kind: 'apply', targetId: v.slice(6) })
                    }}
                  >
                    <option value="skip">跳过</option>
                    <option value="create">新建角色</option>
                    {project.characters.map((c) => (
                      <option key={c.id} value={`apply:${c.id}`} disabled={claimed.has(c.id)}>
                        应用到：{c.name}（{c.id}）
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-ink-muted">
            默认按显示名 / refImage / 本名变体自动匹配。确认后写入外观、服装、定妆图并锁定；不会自动扩容阵容（除非选择「新建角色」）。
            训练素材（多角度 / 服装变体 / 语音 / 对白训条）仅挂角色供 LoRA·Omni，不进画面 prompt。
          </p>
        </div>
      )}

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
              <input
                className="field !w-auto min-w-[6rem] text-xs"
                placeholder="本名 baseName（造型变体用）"
                title="同一角色的不同造型（如 甲（之前）/甲（之后））填相同本名，字幕显示本名"
                value={c.baseName || ''}
                onChange={(e) => updateChar(c.id, { baseName: e.target.value || undefined })}
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
                <label className="label">年龄 age</label>
                <input className="field" value={c.age || ''} onChange={(e) => updateChar(c.id, { age: e.target.value || undefined })} placeholder="如：17" />
              </div>
              <div>
                <label className="label">家境 / 住处 background</label>
                <input className="field" value={c.background || ''} onChange={(e) => updateChar(c.id, { background: e.target.value || undefined })} placeholder="如：富三代·住高档小区" />
              </div>
              <div>
                <label className="label">定妆图 refImage</label>
                <input
                  className="field"
                  value={c.refImage || ''}
                  title="定妆图文件名/前缀；填写后视觉锁定/服装视为权威，重新生成不会覆盖"
                  onChange={(e) => updateChar(c.id, { refImage: e.target.value || undefined })}
                  placeholder="定妆图文件名/前缀，如 char_a_plain"
                />
              </div>
              <div>
                <label className="label">负向 negative（可选）</label>
                <input
                  className="field"
                  value={c.negative || ''}
                  onChange={(e) => updateChar(c.id, { negative: e.target.value || undefined })}
                  placeholder="定妆负向提示"
                />
              </div>
              <div>
                <label className="label">characterKey（可选）</label>
                <input
                  className="field"
                  value={c.characterKey || ''}
                  onChange={(e) => updateChar(c.id, { characterKey: e.target.value || undefined })}
                  placeholder="如 char_a"
                />
              </div>
              <div>
                <label className="label">imagesDir（可选）</label>
                <input
                  className="field"
                  value={c.imagesDir || ''}
                  onChange={(e) => updateChar(c.id, { imagesDir: e.target.value || undefined })}
                  placeholder="GPU 定妆目录名"
                />
              </div>
              {c.trainingAssets && (
                <div className="sm:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-ink-muted">
                  <div className="font-medium text-amber-200/90">LoRA / Omni 训练素材（不进画面 prompt）</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {c.trainingAssets.multiAngleStills && (
                      <span>
                        多角度{' '}
                        {(c.trainingAssets.multiAngleStills.front ? 1 : 0) +
                          (c.trainingAssets.multiAngleStills.side ? 1 : 0) +
                          (c.trainingAssets.multiAngleStills.threeQuarter ? 1 : 0) +
                          (c.trainingAssets.multiAngleStills.extras?.length || 0) +
                          (c.trainingAssets.multiAngleStills.slots?.length || 0)}
                      </span>
                    )}
                    {c.trainingAssets.wardrobeVariants?.length ? (
                      <span>服装变体 {c.trainingAssets.wardrobeVariants.length}</span>
                    ) : null}
                    {c.trainingAssets.voiceSamples?.length ? (
                      <span>语音 {c.trainingAssets.voiceSamples.length}</span>
                    ) : null}
                    {c.trainingAssets.dialogueClips?.length ? (
                      <span>对白训条 {c.trainingAssets.dialogueClips.length}（仅训 LoRA）</span>
                    ) : null}
                    {c.trainingAssets.loraStrengthDefault != null ? (
                      <span>LoRA 默认强度 {c.trainingAssets.loraStrengthDefault}</span>
                    ) : null}
                  </div>
                  {c.trainingAssets.trainingNotes && (
                    <p className="mt-1 text-[11px] text-ink-faint">{c.trainingAssets.trainingNotes}</p>
                  )}
                </div>
              )}
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={Boolean(c.locked || c.refImage?.trim())} disabled={Boolean(c.refImage?.trim())} onChange={(e) => updateChar(c.id, { locked: e.target.checked || undefined })} />
                  锁定外观（视觉锁定/服装不被重新生成覆盖）
                </label>
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
              <div>
                <label className="label">性格（可选）</label>
                <textarea
                  className="field min-h-[56px]"
                  value={c.personality || ''}
                  onChange={(e) => updateChar(c.id, { personality: e.target.value })}
                />
              </div>
              <div>
                <label className="label">人物弧光（可选）</label>
                <textarea
                  className="field min-h-[56px]"
                  value={c.arc || ''}
                  onChange={(e) => updateChar(c.id, { arc: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
