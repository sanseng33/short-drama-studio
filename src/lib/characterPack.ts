/** Parse / match / apply h3-character-pack@1 定妆包 (pure functions). */
import type { Character } from '../types'
import { blankCharacter } from './templates/cast'

export const CHARACTER_PACK_SCHEMA = 'h3-character-pack@1'

export interface PackImages {
  dir: string
  front?: string
  sideA?: string
  back?: string
  sideB?: string
  halfBody?: string
  orbit?: string
  [k: string]: string | undefined
}

export interface PackCharacter {
  refImage: string
  characterKey?: string
  displayName: string
  age?: number | string | null
  background?: string
  appearance?: string
  costume?: string
  props?: string[]
  negative?: string
  sourcePrompt?: string
  images?: PackImages
}

export interface CharacterPack {
  schema: typeof CHARACTER_PACK_SCHEMA
  project?: string
  generatedAt?: string
  assetRoot?: string
  characters: PackCharacter[]
}

/** Per-row mapping chosen in the confirmation UI. */
export type PackMatchAction =
  | { kind: 'apply'; targetId: string }
  | { kind: 'create' }
  | { kind: 'skip' }

export interface PackMatchRow {
  packIndex: number
  pack: PackCharacter
  /** Auto-suggested action before user rematch */
  suggested: PackMatchAction
}

export interface ApplyPackResult {
  characters: Character[]
  updated: number
  created: number
  skipped: number
}

/** Strip trailing （变体）/ (variant) from a display name → Chinese base. */
export function stripVariantParen(name: string): string {
  return (name || '').replace(/\s*[（(][^）)]*[）)]\s*$/u, '').trim()
}

export function joinProps(props: string[] | undefined | null): string {
  if (!props?.length) return ''
  return props.map((p) => String(p).trim()).filter(Boolean).join('、')
}

export function parseCharacterPack(raw: unknown): CharacterPack {
  if (!raw || typeof raw !== 'object') throw new Error('定妆包不是有效的 JSON 对象')
  const o = raw as Record<string, unknown>
  if (o.schema !== CHARACTER_PACK_SCHEMA) {
    throw new Error(`定妆包 schema 须为 ${CHARACTER_PACK_SCHEMA}，实际为 ${String(o.schema ?? '(缺失)')}`)
  }
  if (!Array.isArray(o.characters) || o.characters.length === 0) {
    throw new Error('定妆包 characters 不能为空')
  }
  const characters: PackCharacter[] = o.characters.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`characters[${i}] 无效`)
    const row = c as Record<string, unknown>
    const displayName = String(row.displayName ?? '').trim()
    const refImage = String(row.refImage ?? '').trim()
    if (!displayName) throw new Error(`characters[${i}] 缺少 displayName`)
    if (!refImage) throw new Error(`characters[${i}] 缺少 refImage`)
    const images =
      row.images && typeof row.images === 'object'
        ? ({ ...(row.images as PackImages) } as PackImages)
        : undefined
    return {
      refImage,
      characterKey: row.characterKey != null ? String(row.characterKey) : undefined,
      displayName,
      age: row.age as number | string | null | undefined,
      background: row.background != null ? String(row.background) : undefined,
      appearance: row.appearance != null ? String(row.appearance) : undefined,
      costume: row.costume != null ? String(row.costume) : undefined,
      props: Array.isArray(row.props) ? row.props.map((p) => String(p)) : [],
      negative: row.negative != null ? String(row.negative) : undefined,
      sourcePrompt: row.sourcePrompt != null ? String(row.sourcePrompt) : undefined,
      images,
    }
  })
  return {
    schema: CHARACTER_PACK_SCHEMA,
    project: o.project != null ? String(o.project) : undefined,
    generatedAt: o.generatedAt != null ? String(o.generatedAt) : undefined,
    assetRoot: o.assetRoot != null ? String(o.assetRoot) : undefined,
    characters,
  }
}

function usedIdsFrom(suggestions: PackMatchAction[]): Set<string> {
  const used = new Set<string>()
  for (const s of suggestions) if (s.kind === 'apply') used.add(s.targetId)
  return used
}

/**
 * Auto-match one pack entry against remaining (unused) project characters.
 * Order: exact displayName↔name → exact refImage↔refImage → fuzzy baseName/prefix → characterKey.
 */
export function matchPackCharacter(
  pack: PackCharacter,
  existing: Character[],
  usedIds: Set<string> = new Set(),
): string | null {
  const free = existing.filter((c) => !usedIds.has(c.id))
  const byName = free.find((c) => c.name === pack.displayName)
  if (byName) return byName.id

  if (pack.refImage) {
    const byRef = free.find((c) => c.refImage?.trim() === pack.refImage)
    if (byRef) return byRef.id
  }

  const base = stripVariantParen(pack.displayName)
  if (base) {
    // Prefer exact variant-style name match among free: name starts with base + paren
    const byPrefix = free.find(
      (c) =>
        c.name === base ||
        c.baseName?.trim() === base ||
        stripVariantParen(c.name) === base ||
        (c.name.startsWith(base) && /^[（(]/.test(c.name.slice(base.length))),
    )
    if (byPrefix) return byPrefix.id
  }

  if (pack.characterKey) {
    const byKey = free.find((c) => c.characterKey === pack.characterKey)
    if (byKey) return byKey.id
  }

  return null
}

/** Build confirmation rows with default auto-match suggestions (greedy, no double-assign). */
export function buildMatchRows(pack: CharacterPack, existing: Character[]): PackMatchRow[] {
  const used = new Set<string>()
  return pack.characters.map((pc, packIndex) => {
    const id = matchPackCharacter(pc, existing, used)
    let suggested: PackMatchAction
    if (id) {
      used.add(id)
      suggested = { kind: 'apply', targetId: id }
    } else {
      suggested = { kind: 'skip' }
    }
    return { packIndex, pack: pc, suggested }
  })
}

/** Patch fields from a pack row onto a Character (does not change id). */
export function applyPackToCharacter(target: Character, pack: PackCharacter): Character {
  const base = stripVariantParen(pack.displayName)
  const propsJoined = joinProps(pack.props)
  const age =
    pack.age != null && pack.age !== ''
      ? String(pack.age)
      : undefined
  const next: Character = {
    ...target,
    name: pack.displayName,
    refImage: pack.refImage,
    visualLock: pack.appearance?.trim() || target.visualLock,
    costume: pack.costume?.trim() || target.costume,
    signatureProp: propsJoined,
    locked: true,
  }
  if (age !== undefined) next.age = age
  else delete next.age

  if (pack.background?.trim()) next.background = pack.background.trim()
  // empty background in pack → leave existing

  if (pack.negative != null) {
    const n = pack.negative.trim()
    if (n) next.negative = n
    else delete next.negative
  }

  if (pack.characterKey) next.characterKey = pack.characterKey
  if (base && base !== pack.displayName) next.baseName = base
  else if (pack.characterKey && !next.baseName) {
    // keep existing baseName if any
  }

  const dir = pack.images?.dir?.trim()
  if (dir) next.imagesDir = dir
  else delete next.imagesDir

  return next
}

/** Create a new Character from a pack row (appended after existing). */
export function createCharacterFromPack(pack: PackCharacter, existing: Character[]): Character {
  const blank = blankCharacter(existing, {
    name: pack.displayName,
    role: '角色',
    tags: ['support'],
    visualLock: pack.appearance?.trim() || '待补充外貌与气质',
    costume: pack.costume?.trim() || '待补充服装',
    signatureProp: joinProps(pack.props),
  })
  return applyPackToCharacter(blank, pack)
}

/**
 * Apply confirmed match actions to the cast.
 * `actions` is parallel to pack.characters (or keyed by packIndex via rows).
 */
export function applyCharacterPack(
  existing: Character[],
  pack: CharacterPack,
  actions: PackMatchAction[],
): ApplyPackResult {
  if (actions.length !== pack.characters.length) {
    throw new Error(`匹配结果数量 (${actions.length}) 与定妆包角色数 (${pack.characters.length}) 不一致`)
  }
  let chars = [...existing]
  let updated = 0
  let created = 0
  let skipped = 0
  // Track assign targets to avoid double-apply; creations append sequentially
  const claimed = new Set<string>()

  for (let i = 0; i < pack.characters.length; i++) {
    const pc = pack.characters[i]
    const act = actions[i]
    if (act.kind === 'skip') {
      skipped++
      continue
    }
    if (act.kind === 'create') {
      const neu = createCharacterFromPack(pc, chars)
      chars = [...chars, neu]
      created++
      continue
    }
    // apply
    if (claimed.has(act.targetId)) {
      skipped++
      continue
    }
    const idx = chars.findIndex((c) => c.id === act.targetId)
    if (idx < 0) {
      skipped++
      continue
    }
    claimed.add(act.targetId)
    chars[idx] = applyPackToCharacter(chars[idx], pc)
    updated++
  }

  return { characters: chars, updated, created, skipped }
}

/** Convenience: parse JSON text → pack. */
export function parseCharacterPackJson(text: string): CharacterPack {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('定妆包 JSON 解析失败')
  }
  return parseCharacterPack(raw)
}

export { usedIdsFrom }
