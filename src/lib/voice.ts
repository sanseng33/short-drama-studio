/**
 * Voice (TTS) assignment for dialogue lines — data-driven, no show data in code.
 *
 * Character data carries `voice`: a voice-library name (string) or { description?, id? }.
 * Look variants of one person share a characterKey; a variant without its own voice inherits the voice of the
 * first variant with the same characterKey that has one (explicit voice always wins).
 * Off-list bit parts (no character id) resolve via the pack-level `project.voices` map { speakerName: voice }.
 * Any other named speaker (no character entry, no project.voices entry) gets an AUTO voice in the object form
 * { description, id } (TTS voice design from text): description from generic role words in the speaker name, gender
 * only when the name or the script states it, plus a spoken-style phrase; id = stable hash of projectId:speakerName.
 * Auto voices are marked autoVoice: true and need review. Only a line without any speaker name stays unresolved
 * (missingVoices → export error).
 */
import { sha1Hex } from './hash'
export type VoiceSpec = string | { description?: string; id?: string }

export interface VoiceChar {
  id: string
  name?: string
  baseName?: string
  characterKey?: string | null
  voice?: VoiceSpec | null
}

/** a usable voice: non-empty string, or an object with a non-empty id or description (trimmed copy) */
export function normalizeVoice(v: unknown): VoiceSpec | null {
  if (typeof v === 'string') return v.trim() || null
  if (v && typeof v === 'object') {
    const o = v as { description?: unknown; id?: unknown }
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const description = typeof o.description === 'string' ? o.description.trim() : ''
    if (!id && !description) return null
    return { ...(description ? { description } : {}), ...(id ? { id } : {}) }
  }
  return null
}

/** character id → resolved voice (own, else inherited from a same-characterKey variant), null when none */
export function characterVoices(chars: VoiceChar[]): Map<string, VoiceSpec | null> {
  const byKey = new Map<string, VoiceSpec>()
  for (const c of chars) {
    const k = c.characterKey?.trim()
    const v = normalizeVoice(c.voice)
    if (k && v && !byKey.has(k)) byKey.set(k, v)
  }
  return new Map(chars.map((c) => [c.id, normalizeVoice(c.voice) ?? (c.characterKey?.trim() ? byKey.get(c.characterKey.trim()) ?? null : null)]))
}

/** characters with the resolved (inherited) voice filled in; characters without any voice are left as they are */
export function withCharacterVoices<T extends VoiceChar>(chars: T[]): T[] {
  const m = characterVoices(chars)
  return chars.map((c) => {
    const v = m.get(c.id)
    return v ? { ...c, voice: v } : c
  })
}

interface LineLike {
  speaker?: string | null
  speakerName?: string | null
  text: string
}

/** the character entry a line belongs to (speaker id, else a name / baseName match), null for an off-list speaker */
function charOf(l: LineLike, chars: VoiceChar[]): VoiceChar | null {
  if (l.speaker) {
    const c = chars.find((x) => x.id === l.speaker)
    if (c) return c
  }
  const n = l.speakerName?.trim()
  return (n && chars.find((x) => x.name === n || x.baseName === n)) || null
}

/** voice of one line: character voice (characterKey inheritance); else project.voices[speakerName]; else the auto voice
 *  of an off-list speaker. A listed character without a voice is NOT auto-voiced (its data must say it). */
export function lineVoice(l: LineLike, chars: VoiceChar[], extra: Record<string, unknown> = {}, auto: Record<string, AutoVoice> = {}): VoiceSpec | null {
  const m = characterVoices(chars)
  const c = charOf(l, chars)
  if (c && m.get(c.id)) return m.get(c.id)!
  const n = l.speakerName?.trim()
  if (!n) return null
  const v = normalizeVoice(extra[n])
  if (v) return v
  if (c) return null
  return auto[n]?.voice ?? null
}

/** every line gets `voice` (null when unresolved); an auto voice adds autoVoice: true */
export function withLineVoices<L extends LineLike>(lines: L[], chars: VoiceChar[], extra: Record<string, unknown> = {}, auto: Record<string, AutoVoice> = {}): (L & { voice: VoiceSpec | null; autoVoice?: true })[] {
  return lines.map((l) => {
    const voice = lineVoice(l, chars, extra, auto)
    const n = l.speakerName?.trim() || ''
    const isAuto = Boolean(voice && auto[n] && voice === auto[n].voice)
    return { ...l, voice, ...(isAuto ? { autoVoice: true as const } : {}) }
  })
}

// ---------------- auto voice for off-list speakers ----------------

/** generic role words → age band (no show data: everyday roles any script uses) */
const AGE_ROLES: [RegExp, string][] = [
  [/(爷爷|奶奶|外公|外婆|姥姥|姥爷|老人|老大爷|大爷|大妈|老太太|老奶奶|老爷爷)/, '老年人'],
  [/(叔叔|阿姨|大叔|大婶|大姐|大哥|爸爸|妈妈|父亲|母亲|家长)/, '中年人'],
  [/(小孩|孩子|小朋友|男孩|女孩|小学生)/, '儿童'],
  [/(同学|学生|班长|学长|学姐|学弟|学妹|少年|少女|男生|女生|课代表|室友|新生)/, '青少年'],
  [/(老师|教师|教练|校长|主任|班主任|教导|医生|护士|保安|司机|老板|经理|店员|店主|服务员|警察|记者|主持人|职员|员工|前台|快递员|房东|保洁|厨师)/, '成年人'],
]
/** roles that speak with authority (tone hint) */
const AUTHORITY = /(老师|教师|教练|校长|主任|班主任|教导|警察|保安|经理|老板|家长|爸爸|妈妈|父亲|母亲)/
const FEMALE = /(女|阿姨|大妈|大婶|大姐|奶奶|外婆|姥姥|妈妈|母亲|学姐|学妹|少女|女孩|老太太|老奶奶)/
const MALE = /(男|叔叔|大叔|大哥|大爷|爷爷|外公|姥爷|爸爸|父亲|学长|学弟|少年|男孩|先生|老爷爷)/

export interface AutoVoice {
  voice: { description: string; id: string }
  autoVoice: true
  speakerName: string
  /** where age / gender came from */
  basis: { age: string | null; gender: 'female' | 'male' | null; genderFrom: 'name' | 'script' | null }
  lines: number
  shots: string[]
}

/** voice-design description (Chinese) from the speaker name, the script text around its lines and the lines themselves */
export function autoVoiceDescription(speakerName: string, scriptText = '', lines: string[] = []): { description: string; basis: AutoVoice['basis'] } {
  const name = speakerName.trim()
  const ageHit = AGE_ROLES.find(([re]) => re.test(name))
  const age = ageHit ? ageHit[1] : null
  const role = ageHit ? name.match(ageHit[0])![0] : ''
  let gender: AutoVoice['basis']['gender'] = FEMALE.test(name) ? 'female' : MALE.test(name) ? 'male' : null
  let genderFrom: AutoVoice['basis']['genderFrom'] = gender ? 'name' : null
  // the script states it: 女老师 / 男同学 right before the role word
  if (!gender && role) {
    const f = new RegExp(`女${role}`).test(scriptText)
    const m = new RegExp(`男${role}`).test(scriptText)
    if (f !== m) {
      gender = f ? 'female' : 'male'
      genderFrom = 'script'
    }
  }
  const who = age || '普通路人'
  const g = gender === 'female' ? '女声' : gender === 'male' ? '男声' : '中性音色，不刻意区分男女'
  const all = lines.join('')
  const tone = AUTHORITY.test(name)
    ? '语气带点管教的威严，吐字清楚'
    : /[！!]/.test(all)
      ? '情绪外放，音量偏大'
      : /[？?]/.test(all)
        ? '带点好奇的追问语气'
        : '语速适中'
  return { description: `${who}${gender ? '' : '，'}${g}，像日常说话一样自然口语化，${tone}`, basis: { age, gender, genderFrom } }
}

/** stable id of an auto voice: same project + speaker name → same id (all episodes); distinct names → distinct ids */
export function autoVoiceId(projectId: string, speakerName: string): string {
  return `auto_${sha1Hex(`${projectId}:${speakerName.trim()}`).slice(0, 12)}`
}

interface ShotForVoice {
  id: string
  visual?: string
  action?: string
  dialogueLines?: LineLike[]
  dialogue?: string
  speaker?: string | null
  speakerName?: string | null
}

/** auto voices for every named speaker with no character entry and no project.voices entry */
export function autoVoices(shots: ShotForVoice[], chars: VoiceChar[], extra: Record<string, unknown> = {}, projectId = ''): Record<string, AutoVoice> {
  const acc = new Map<string, { text: string[]; lines: string[]; shots: string[] }>()
  for (const s of shots) {
    const ls: LineLike[] = s.dialogueLines?.length ? s.dialogueLines : s.dialogue?.trim() ? [{ speaker: s.speaker, speakerName: s.speakerName, text: s.dialogue }] : []
    for (const l of ls) {
      const n = l.speakerName?.trim()
      if (!n || charOf(l, chars) || normalizeVoice(extra[n])) continue
      const a = acc.get(n) || { text: [], lines: [], shots: [] }
      a.text.push(s.visual || '', s.action || '')
      a.lines.push(l.text || '')
      if (!a.shots.includes(s.id)) a.shots.push(s.id)
      acc.set(n, a)
    }
  }
  const out: Record<string, AutoVoice> = {}
  for (const [n, a] of acc) {
    const { description, basis } = autoVoiceDescription(n, a.text.join('\n'), a.lines)
    out[n] = { voice: { description, id: autoVoiceId(projectId, n) }, autoVoice: true, speakerName: n, basis, lines: a.lines.length, shots: a.shots }
  }
  return out
}

/** dialogue lines without a resolvable voice: "<shotId>: <speakerName|speaker>「text」" (empty = ok) */
export function missingVoices(shots: { id: string; dialogueLines?: (LineLike & { voice?: VoiceSpec | null })[] }[]): string[] {
  const out: string[] = []
  for (const s of shots)
    for (const l of s.dialogueLines || []) if (!normalizeVoice(l.voice)) out.push(`${s.id}: ${l.speakerName || l.speaker || '?'}「${l.text}」`)
  return out
}

// ---------------- character identity + auto voice (generic: gender + age → voice design) ----------------

export interface IdentityChar extends VoiceChar {
  role?: string
  tags?: string[]
  visualLock?: string
  age?: string
  gender?: string
  refImage?: string | null
  autoVoice?: boolean
  ageBand?: string
  lookVariants?: string[]
  lookalikeOf?: string | null
  background?: string
}

/** lookalike: explicit lookalikeOf (id or name), else visualLock / background saying it resembles another person's name */
export function lookalikeOfChar(c: IdentityChar, chars: IdentityChar[]): string | null {
  const key = (x: IdentityChar) => x.characterKey || personKeyOf(x)
  const others = chars.filter((o) => key(o) !== key(c))
  const ex = c.lookalikeOf?.trim()
  if (ex) return others.find((o) => o.id === ex || o.name === ex || personKeyOf(o) === ex)?.id ?? null
  const t = `${c.visualLock || ''} ${c.background || ''}`
  for (const o of others) {
    const n = personKeyOf(o)
    if (n.length >= 2 && new RegExp(`(与|和|跟|酷似|像)${n}[^，。；]{0,6}(相似|相像|一样|相同|酷似|神似|如出一辙)|酷似${n}|神似${n}`).test(t)) return o.id
  }
  return null
}

/** numeric age → age band used in voice descriptions (text age passes through the role table) */
export function ageBand(age?: string | number | null): string | null {
  const n = typeof age === 'number' ? age : parseInt(String(age ?? '').replace(/[^\d]/g, ''), 10)
  if (!Number.isFinite(n)) {
    const t = String(age ?? '')
    const hit = AGE_ROLES.find(([re]) => re.test(t))
    return hit ? hit[1] : null
  }
  return n < 12 ? '儿童' : n < 19 ? '青少年' : n < 35 ? '青年' : n < 55 ? '中年人' : '老年人'
}

const FEMALE_TXT = /(女|她|妻|母|妈|姐|妹|奶奶|外婆|姥姥|阿姨|少女|女孩|千金|小姐|公主|皇后|夫人|太太)/
const MALE_TXT = /(男|他|夫|父|爸|哥|弟|爷|叔|伯|少年|男孩|少爷|先生|公子|王爷)/
/** explicit gender field, else a gender word in role / visualLock / tags; null when neither or both */
export function charGender(c: IdentityChar): 'female' | 'male' | null {
  const g = c.gender?.trim()
  if (g) return /^(f|female|女)/i.test(g) ? 'female' : /^(m|male|男)/i.test(g) ? 'male' : null
  const t = [c.role, c.visualLock, ...(c.tags || [])].join(' ')
  const f = FEMALE_TXT.test(t)
  const m = MALE_TXT.test(t)
  return f === m ? null : f ? 'female' : 'male'
}

/** person key shared by look variants: explicit characterKey, else baseName, else name minus （…）/(…) */
export function personKeyOf(c: IdentityChar): string {
  return c.characterKey?.trim() || c.baseName?.trim() || (c.name || c.id).replace(/[（(][^）)]*[）)]\s*$/, '').trim()
}

/** stable ASCII character key from the person name (same person → same key in every run) */
export function stableCharacterKey(person: string): string {
  return /^[a-z0-9_]+$/i.test(person) ? person : `ck_${sha1Hex(person).slice(0, 8)}`
}

/** voice-design description from gender + age band (+ authority tone from the role) */
export function characterVoiceDescription(c: IdentityChar): string {
  const g = charGender(c)
  const band = ageBand(c.age) || '成年人'
  const gv = g === 'female' ? '女声' : g === 'male' ? '男声' : '中性音色'
  const tone = AUTHORITY.test(`${c.role || ''}`) ? '语气沉稳有分量' : '语速适中，像日常说话一样自然'
  return `${band}${gv}，${tone}`
}

/**
 * Generic identity rule for every character: characterKey (shared by look variants), refImage prefix
 * `${characterKey}_v<n>` when unset (opts.refImage, generator only), gender when derivable, and an auto voice { description, id } from gender + age
 * when no own / inherited voice exists (id = stable hash of projectId:characterKey → all variants share it).
 */
export function withCharacterIdentity<T extends IdentityChar>(chars: T[], projectId = '', opts: { refImage?: boolean } = {}): T[] {
  const variantNo = new Map<string, number>()
  const withKeys = chars.map((c) => {
    const key = c.characterKey?.trim() || stableCharacterKey(personKeyOf(c))
    const n = (variantNo.get(key) || 0) + 1
    variantNo.set(key, n)
    const g = charGender(c)
    return {
      ...c,
      characterKey: key,
      ...(ageBand(c.age) ? { ageBand: ageBand(c.age)! } : {}),
      ...(c.refImage?.trim() || !opts.refImage ? {} : { refImage: `${key}_v${n}` }),
      ...(!c.gender?.trim() && g ? { gender: g } : {}),
    }
  })
  const inherited = withCharacterVoices(withKeys)
  const firstOfKey = new Map<string, IdentityChar>()
  for (const c of inherited) if (!firstOfKey.has(c.characterKey!)) firstOfKey.set(c.characterKey!, c)
  const linked = inherited.map((c) => ({
    ...c,
    lookVariants: inherited.filter((o) => o.id !== c.id && o.characterKey === c.characterKey).map((o) => o.id),
    lookalikeOf: lookalikeOfChar(c, inherited),
  }))
  // a lookalike pair (different people) never shares a voice id
  return linked.map((c) => {
    if (normalizeVoice(c.voice)) return c
    const head = firstOfKey.get(c.characterKey!)!
    const src = charGender(c) || !head ? c : head
    return { ...c, voice: { description: characterVoiceDescription({ ...src, age: c.age || head?.age }), id: autoVoiceId(projectId, c.characterKey!) }, autoVoice: true }
  })
}
