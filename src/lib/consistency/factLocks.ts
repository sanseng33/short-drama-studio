/** PK-07：设定事实投影、锁定合并；不改 settingFacts 语义，只追加 items。 */
import type { Project, SettingFactItem } from '../../types'

export function projectFactsFromItems(items: SettingFactItem[] | undefined | null): string[] {
  if (!Array.isArray(items)) return []
  return items.map((i) => i.text).filter((t) => typeof t === 'string' && t.trim() !== '')
}

export function itemsFromFacts(facts: string[] | undefined | null, source = 'legacy'): SettingFactItem[] {
  const list = Array.isArray(facts) ? facts : []
  return list.map((text, i) => ({
    id: `sf-${i + 1}`,
    text: typeof text === 'string' ? text : String(text ?? ''),
    locked: false,
    source,
  }))
}

/** 有 items 时同步投影（过滤空串）。无 items 时不改 settingFacts。 */
export function syncFactsProjection(project: Project): Project {
  if (!Array.isArray(project.settingFactItems)) return project
  return { ...project, settingFacts: projectFactsFromItems(project.settingFactItems) }
}

/**
 * 整体替换事实时保留已锁定条目（按 text 匹配），其余按新结果替换。
 * 与 mergeLockedCharacters 同思路。
 */
export function mergeLockedFacts(
  prevItems: SettingFactItem[] | undefined | null,
  nextFacts: string[] | undefined | null,
): SettingFactItem[] {
  const locked = (prevItems || []).filter((i) => i.locked)
  const lockedTexts = new Set(locked.map((i) => i.text))
  const out: SettingFactItem[] = locked.map((i) => ({ ...i }))
  let n = out.length
  for (const raw of nextFacts || []) {
    const text = typeof raw === 'string' ? raw : String(raw ?? '')
    if (lockedTexts.has(text)) continue
    n += 1
    out.push({ id: `sf-${n}`, text, locked: false, source: 'extract' })
  }
  return out
}

export function isScriptLocked(project: Project, episode: number): boolean {
  return !!project.locks?.scripts?.[episode]
}

export function isOutlineLocked(project: Project): boolean {
  return !!project.locks?.outline
}

export function overwriteLockedScriptMessage(episode: number): string {
  return `将覆盖已锁定的第 ${episode} 集剧本，下游分镜将标为失效`
}

export function overwriteLockedOutlineMessage(): string {
  return '将覆盖已锁定的大纲'
}
