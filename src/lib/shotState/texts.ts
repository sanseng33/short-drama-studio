/**
 * 受控派生文本与 provenance，以及语义审查记录。
 * 派生文本只能由状态源经已声明的 compiler 生成；手改后 invalidated + reviewRequired，只有显式 deriveText（重编译）
 * 或 adoptUserText（转为用户文本并重新审查）才能恢复，不会被静默再包装。
 */
import { hashSource, hashText } from './hashing'
import type {
  SemanticFieldStatus,
  SemanticReview,
  SemanticVerdict,
  ShotStateDoc,
  StateText,
  TextProvenance,
  TextStatus,
} from './types'

export const COMPILER_VERSION = '0.1.0'

export type CompilerField = 'castLine' | 'firstFrameLine' | 'speechLine'
export type NameOf = (id: string) => string

export const COMPILER_FIELDS: readonly CompilerField[] = ['castLine', 'firstFrameLine', 'speechLine']
export const isCompilerField = (f: string): f is CompilerField => (COMPILER_FIELDS as readonly string[]).includes(f)
export const compilerIdOf = (field: CompilerField): string => `shot-state/${field}`

const FRAME_LABEL = { full: '全身可见', offscreen: '画外', absent: '不在画面', unverified: '未核验' } as const
const SPEECH_LABEL = { onscreen: '画内发声', offscreen: '画外发声', inner: '内心独白', voice_only: '纯画外音' } as const

function ordered(doc: ShotStateDoc): string[] {
  const s = doc.source
  return [...s.displayOrder.filter((x) => s.cast.includes(x)), ...s.cast.filter((x) => !s.displayOrder.includes(x))]
}

function render(field: CompilerField, doc: ShotStateDoc, nameOf: NameOf): string {
  const s = doc.source
  const order = ordered(doc)
  if (field === 'castLine') return `出演：${order.map(nameOf).join('、') || '无'}`
  if (field === 'firstFrameLine') {
    const parts = order.map((id) => {
      const e = s.firstFrame.find((x) => x.id === id)
      if (!e) return `${nameOf(id)}（${FRAME_LABEL.unverified}）`
      if (e.kind === 'partial') return `${nameOf(id)}（局部可见：${(e.parts || []).join('、') || '未写明'}）`
      return `${nameOf(id)}（${FRAME_LABEL[e.kind]}）`
    })
    return `首帧：${parts.join('；') || '无人'}`
  }
  const sp = order.flatMap((id) => s.speech.filter((x) => x.id === id).map((x) => `${nameOf(id)}（${SPEECH_LABEL[x.mode]}）`))
  return `发声：${sp.join('；') || '无'}`
}

const upsert = (doc: ShotStateDoc, t: StateText): ShotStateDoc => ({
  ...doc,
  texts: doc.texts.some((x) => x.field === t.field) ? doc.texts.map((x) => (x.field === t.field ? t : x)) : [...doc.texts, t],
})

/** 显式（重）编译：由当前状态源生成受控文本，覆盖同名字段的旧文本。 */
export function deriveText(doc: ShotStateDoc, field: CompilerField, nameOf: NameOf = (id) => id): ShotStateDoc {
  const text = render(field, doc, nameOf)
  const provenance: TextProvenance = {
    field,
    source: 'derived',
    compilerId: compilerIdOf(field),
    compilerVersion: COMPILER_VERSION,
    sourceHash: hashSource(doc.source),
    textHash: hashText(text),
    invalidated: false,
    reviewRequired: false,
  }
  return upsert(doc, { field, text, provenance })
}

/** 写入或修改文本。手改派生文本 -> invalidated + reviewRequired（保留原 sourceHash/textHash 作证据）。 */
export function setText(doc: ShotStateDoc, field: string, text: string): ShotStateDoc {
  const cur = doc.texts.find((t) => t.field === field)
  if (!cur) {
    return upsert(doc, {
      field,
      text,
      provenance: { field, source: 'user', textHash: hashText(text), invalidated: false, reviewRequired: false },
    })
  }
  if (cur.provenance.source === 'derived') {
    if (cur.text === text) return doc
    return upsert(doc, { field, text, provenance: { ...cur.provenance, invalidated: true, reviewRequired: true } })
  }
  if (cur.text === text) return doc
  return upsert(doc, { field, text, provenance: { field, source: 'user', textHash: hashText(text), invalidated: false, reviewRequired: false } })
}

/** 显式把失效派生文本转为用户文本；之后仍需语义审查 pass。 */
export function adoptUserText(doc: ShotStateDoc, field: string): ShotStateDoc {
  const cur = doc.texts.find((t) => t.field === field)
  if (!cur) throw new Error(`shot-state: no text field "${field}"`)
  return upsert(doc, { field, text: cur.text, provenance: { field, source: 'user', textHash: hashText(cur.text), invalidated: false, reviewRequired: false } })
}

export interface ReviewInput {
  field: string
  verdict: SemanticVerdict
  reviewer: 'human' | 'llm'
  note?: string
  at?: string
}

/** 追加审查记录，绑定当前文本 hash 与状态源 hash；任一变化后该记录不再生效。 */
export function addReview(doc: ShotStateDoc, input: ReviewInput): ShotStateDoc {
  const t = doc.texts.find((x) => x.field === input.field)
  if (!t) throw new Error(`shot-state: cannot review missing text field "${input.field}"`)
  const review: SemanticReview = {
    field: input.field,
    verdict: input.verdict,
    reviewer: input.reviewer,
    textHash: hashText(t.text),
    sourceHash: hashSource(doc.source),
    ...(input.note ? { note: input.note } : {}),
    ...(input.at ? { at: input.at } : {}),
  }
  return { ...doc, reviews: [...doc.reviews, review] }
}

export function textStatus(doc: ShotStateDoc, t: StateText): TextStatus {
  const p = t.provenance
  if (p.source === 'user') return 'user'
  if (p.invalidated || hashText(t.text) !== p.textHash) return 'invalidated'
  if (p.sourceHash !== hashSource(doc.source)) return 'stale'
  return 'valid_derived'
}

/** 有效派生文本由模板层证明；其余文本取最近一条与当前 hash 匹配的审查，没有则是 unknown（不是 fail）。 */
export function semanticFieldStatus(doc: ShotStateDoc, t: StateText): SemanticFieldStatus {
  const textHash = hashText(t.text)
  const sourceHash = hashSource(doc.source)
  const matching = doc.reviews.filter((r) => r.field === t.field && r.textHash === textHash && r.sourceHash === sourceHash)
  if (matching.length) return matching[matching.length - 1].verdict
  const st = textStatus(doc, t)
  if (st === 'valid_derived') return 'derived_valid'
  if (st === 'invalidated' || st === 'stale') return 'review_required'
  return t.provenance.reviewRequired ? 'review_required' : 'unknown'
}
