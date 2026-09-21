/** Cast resolution by tags / role keywords — never assume chars[0/1/2]. */
import type { Character } from '../../types'

export type CastTag =
  | 'protagonist'
  | 'antagonist'
  | 'support'
  | 'mentor'
  | 'romantic'
  | 'deuteragonist'

export type CastPresetId =
  | 'classic_triangle'
  | 'solo_antagonist'
  | 'dual_leads'
  | 'heroine_mentor_villain'
  | 'blank_protagonist'

export interface CastPresetMeta {
  id: CastPresetId
  label: string
  description: string
}

export const CAST_PRESETS: CastPresetMeta[] = [
  { id: 'classic_triangle', label: '经典三角', description: '主角 + 情感线/搭档 + 对手（可再改）' },
  { id: 'solo_antagonist', label: '单主+对手', description: '无情感线，适合纯打脸 / 商战 / 复仇' },
  { id: 'dual_leads', label: '双主角', description: '两位并重主角，对手可选' },
  { id: 'heroine_mentor_villain', label: '女主+导师+反派', description: '女主成长线，导师助力，反派施压' },
  { id: 'blank_protagonist', label: '空白单主角', description: '从一人起步，自行增删' },
]

export const CAST_SOFT_MAX = 8

const TAG_ALIASES: Record<CastTag, string[]> = {
  protagonist: ['protagonist', '主角', '男主', '女主', '男一', '女一', '主人公'],
  antagonist: ['antagonist', '反派', '对手', '反一', '敌手', '反角'],
  support: ['support', '配角', '助力', '搭档', '同伴', '挚友'],
  mentor: ['mentor', '导师', '师傅', '师父', '引路人', '军师'],
  romantic: ['romantic', '感情线', '恋人', 'CP', '伴侣', '爱人', '女主线', '男主线'],
  deuteragonist: ['deuteragonist', '第二主角', '双男主', '双女主', '并肩主角'],
}

function haystack(c: Character): string {
  return `${(c.tags || []).join(' ')} ${c.role}`.toLowerCase()
}

function hasTag(c: Character, tag: CastTag): boolean {
  const h = haystack(c)
  return TAG_ALIASES[tag].some((k) => h.includes(k.toLowerCase()))
}

function pick(chars: Character[], tag: CastTag, used: Set<string>): Character | undefined {
  const hit = chars.find((c) => !used.has(c.id) && hasTag(c, tag))
  if (hit) {
    used.add(hit.id)
    return hit
  }
  return undefined
}

export interface ResolvedCast {
  protagonist: Character
  deuteragonist?: Character
  romantic?: Character
  mentor?: Character
  antagonist?: Character
  support: Character[]
  all: Character[]
}

/** Resolve cast from tags/role. Fallback: first character = protagonist. */
export function resolveCast(chars: Character[]): ResolvedCast {
  if (!chars.length) throw new Error('至少需要 1 个角色才能生成')
  const used = new Set<string>()
  const protagonist =
    pick(chars, 'protagonist', used) ??
    (() => {
      used.add(chars[0].id)
      return chars[0]
    })()

  // Romantic: avoid double-claiming the sole protagonist as romantic
  let romantic = pick(chars, 'romantic', used)
  if (romantic && romantic.id === protagonist.id) romantic = undefined

  const deuteragonist = pick(chars, 'deuteragonist', used)
  const mentor = pick(chars, 'mentor', used)
  const antagonist = pick(chars, 'antagonist', used)

  const taggedSupport: Character[] = []
  for (const c of chars) {
    if (used.has(c.id)) continue
    if (hasTag(c, 'support')) {
      used.add(c.id)
      taggedSupport.push(c)
    }
  }
  const rest = chars.filter((c) => !used.has(c.id))
  return {
    protagonist,
    deuteragonist,
    romantic,
    mentor,
    antagonist,
    support: [...taggedSupport, ...rest],
    all: chars,
  }
}

export function newCharacterId(existing: Character[]): string {
  let n = existing.length + 1
  const ids = new Set(existing.map((c) => c.id))
  while (ids.has(`c${n}`)) n += 1
  return `c${n}`
}

export function blankCharacter(existing: Character[], patch: Partial<Character> = {}): Character {
  return {
    id: patch.id || newCharacterId(existing),
    name: patch.name || `角色${existing.length + 1}`,
    role: patch.role || '配角',
    tags: patch.tags ? [...patch.tags] : ['support'],
    visualLock: patch.visualLock || '待补充外貌与气质',
    costume: patch.costume || '待补充服装',
    signatureProp: patch.signatureProp ?? '',
  }
}

export function withTags(c: Character, tags: string[]): Character {
  return { ...c, id: c.id, tags: [...tags] }
}


/** Build a cast list for a named preset. Optional seed copies names/looks from genre defaults. */
export function buildPresetCast(preset: CastPresetId, seed: Character[] = []): Character[] {
  const s = (i: number, fb: Partial<Character>) => {
    const src = seed[i]
    return blankCharacter([], {
      ...(src || {}),
      ...fb,
      id: src?.id || fb.id,
      name: fb.name || src?.name,
      role: fb.role || src?.role,
      tags: fb.tags,
      visualLock: src?.visualLock || fb.visualLock,
      costume: src?.costume || fb.costume,
      signatureProp: src?.signatureProp ?? fb.signatureProp ?? '',
    })
  }

  if (preset === 'blank_protagonist') {
    return [
      blankCharacter([], {
        id: 'c1',
        name: '主角',
        role: '主角',
        tags: ['protagonist'],
        visualLock: '请描述外貌、年龄、标志特征',
        costume: '请描述服装',
        signatureProp: '',
      }),
    ]
  }

  if (preset === 'solo_antagonist') {
    const p = s(0, {
      id: 'c1',
      name: seed[0]?.name || '主角',
      role: '主角',
      tags: ['protagonist'],
      visualLock: '请描述主角外貌',
      costume: '请描述服装',
    })
    const a = s(seed[2] ? 2 : 1, {
      id: 'c2',
      name: seed[2]?.name || seed[1]?.name || '对手',
      role: '反派·对手',
      tags: ['antagonist'],
      visualLock: '请描述对手外貌',
      costume: '请描述服装',
    })
    return [p, a]
  }

  if (preset === 'dual_leads') {
    const a = s(0, {
      id: 'c1',
      name: seed[0]?.name || '主角A',
      role: '第一主角',
      tags: ['protagonist'],
      visualLock: '请描述第一主角外貌',
      costume: '请描述服装',
    })
    const b = s(1, {
      id: 'c2',
      name: seed[1]?.name || '主角B',
      role: '第二主角',
      tags: ['deuteragonist'],
      visualLock: '请描述第二主角外貌',
      costume: '请描述服装',
    })
    return [a, b]
  }

  if (preset === 'heroine_mentor_villain') {
    const h = s(0, {
      id: 'c1',
      name: seed[0]?.name || '女主',
      role: seed[0]?.role?.includes('女') ? seed[0].role : '女主',
      tags: ['protagonist'],
      visualLock: '请描述女主外貌',
      costume: '请描述服装',
    })
    const m = blankCharacter([h], {
      id: 'c2',
      name: '导师',
      role: '导师',
      tags: ['mentor'],
      visualLock: '沉稳长者或高人气质，眉眼有故事',
      costume: '朴素暗纹长袍或现代简约深色大衣',
      signatureProp: '信物 / 令牌',
    })
    const v = s(2, {
      id: 'c3',
      name: seed[2]?.name || '反派',
      role: seed[2]?.role || '反派',
      tags: ['antagonist'],
      visualLock: '请描述反派外貌',
      costume: '请描述服装',
    })
    return [h, m, v]
  }

  // classic_triangle
  const p = s(0, {
    id: 'c1',
    name: seed[0]?.name || '主角',
    role: seed[0]?.role || '主角',
    tags: ['protagonist'],
    visualLock: '请描述主角外貌',
    costume: '请描述服装',
  })
  const r = s(1, {
    id: 'c2',
    name: seed[1]?.name || '搭档',
    role: seed[1]?.role || '情感线/搭档',
    tags: ['romantic', 'support'],
    visualLock: '请描述搭档外貌',
    costume: '请描述服装',
  })
  const a = s(2, {
    id: 'c3',
    name: seed[2]?.name || '对手',
    role: seed[2]?.role || '反派',
    tags: ['antagonist'],
    visualLock: '请描述对手外貌',
    costume: '请描述服装',
  })
  return [p, r, a]
}

export function genreDefaultPreset(genre: string): CastPresetId {
  if (genre === '大女主' || genre === '古风女频重生' || genre === '都市重生') {
    return 'heroine_mentor_villain'
  }
  return 'classic_triangle'
}

export function suggestedBeatCount(castSize: number, seconds: number): number {
  if (castSize <= 1) return seconds >= 90 ? 4 : 3
  if (castSize === 2) return 4
  if (castSize >= 5) return seconds >= 80 ? 6 : 5
  return 5
}

export function suggestedShotCount(castSize: number, seconds: number): number {
  const base = castSize <= 1 ? 5 : castSize === 2 ? 6 : castSize >= 5 ? 9 : 7
  if (seconds >= 90) return base + 1
  if (seconds <= 60) return Math.max(4, base - 1)
  return base
}

/** Short label for prompts / dialogue attribution */
export function castSummary(chars: Character[]): string {
  return chars.map((c) => `${c.name}（${c.role}${c.tags?.length ? '/' + c.tags.join('+') : ''}）`).join('、')
}
