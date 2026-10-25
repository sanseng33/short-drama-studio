/**
 * Prompt text the video model would draw as text: abstract emotion words (→ visible expression + action, table in
 * emotionVocab), inner-monologue clauses (dropped), quotation marks with their quoted content (dropped; a quoted line
 * after a speech verb → 嘴唇开合). Used by the final render pass (renderPrompt) and the repack gate (promptTextRisks).
 */
import { EMOTION_PREFIX, EMOTION_SUFFIX, EMOTION_VISIBLE, INNER_MONOLOGUE } from './emotionVocab'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const byLen = (a: string[]) => [...a].sort((x, y) => y.length - x.length).map(esc).join('|')
const WORDS = byLen(Object.keys(EMOTION_VISIBLE))
export const EMOTION_RE = new RegExp(`(?:${WORDS})`)
/** one emotion word with its wrappers (一脸X的样子, 带点X, X地…) */
const FORM_RE = new RegExp(`(?:${byLen(EMOTION_PREFIX)})?(?:的)?(${WORDS})(?:${byLen(EMOTION_SUFFIX)})?`, 'g')
export const INNER_RE = new RegExp(`(?:${byLen(INNER_MONOLOGUE)})`)
/** every quote mark the gate rejects */
export const QUOTE_RE = /[“”‘’「」『』"'《》]/
const QUOTED_RE = /“[^“”]*”|‘[^‘’]*’|「[^「」]*」|『[^『』]*』|"[^"]*"|'[^']*'|《[^《》]*》/g
const SPEECH_QUOTE_RE = new RegExp(`(?:开口)?(?:说|喊|道|问|骂|念|叫|嚷|嘀咕|嘟囔|回答)(?:了|着|出)?(?:一句|一声)?[：:，,]?\\s*(?:${QUOTED_RE.source})`, 'g')
/** visible body / face words: a clause with one keeps its own action and gets the emotion replaced in place */
const BODY_RE = /眉|眼|嘴|唇|脸|肩|手|指|头|下巴|脚|腿|身|背|喉|鼻|咬肌|呼吸|视线|目光|胸|牙|额|耳|脖|膝|腰|拳|笑|叹|哈欠/
/** lines never touched (style / limits / framing / fixed no-text) */
const KEEP_LINE = /^(?:风格|限制|景别)[：:]|^画面中没有任何文字/

export interface TextRewrite {
  kind: 'emotion' | 'inner' | 'quote'
  from: string
  to: string
}

function dedupeParts(phrase: string, ctx: string): string {
  return phrase
    .split('、')
    .filter((p) => !ctx.includes(p))
    .join('、')
}

/** one clause (no separators): emotion words → visible actions; label prefix (表演：/ N秒，…：) kept */
/** ctx: the rest of the prompt plus actions already emitted (no visible action is written twice in one prompt) */
function rewriteClause(clause: string, ctx: string): string {
  const k = Math.max(clause.lastIndexOf('：'), clause.lastIndexOf(':'))
  const label = k >= 0 ? clause.slice(0, k + 1) : ''
  const body = k >= 0 ? clause.slice(k + 1) : clause
  if (!EMOTION_RE.test(body)) return clause
  const rest = body.replace(FORM_RE, '')
  const adverbial = new RegExp(`(?:${byLen(EMOTION_PREFIX)})(?:的)?(?:${WORDS})|(?:${WORDS})地`).test(body)
  if (BODY_RE.test(rest) || adverbial) {
    // the clause has its own action. A modifier (一脸X / X地 / X的… / X里…) is removed and its visible action follows
    // the clause; a predicate (嘴硬X / X但… / 硬撑着) is replaced in place.
    const after: string[] = []
    const out = body.replace(new RegExp(`${FORM_RE.source}([的里着]?)`, 'g'), (m, w: string, tail: string, off: number) => {
      const v = EMOTION_VISIBLE[w]
      const modifier = tail === '的' || tail === '里' || m.endsWith('地') || EMOTION_PREFIX.some((p) => m.startsWith(p))
      if (modifier && off + m.length < body.length) {
        after.push(v)
        return ''
      }
      const d = dedupeParts(v, ctx) || ''
      return d && m.startsWith('的') && off > 0 ? `，${d}` : d
    })
    const vis = dedupeParts([...new Set(after.join('、').split('、'))].filter(Boolean).join('、'), `${ctx}${out}`)
    const res = (out.replace(/(却|又|还|也|但)$/, '') + (vis ? `，${vis}` : '')).replace(/、{2,}/g, '、').replace(/^[、，]|[、，]$/g, '').replace(/，{2,}/g, '，')
    return label + res
  }
  // purely abstract clause (听到结果的错愕 / 是认命式的无奈): the visible actions of its words replace it
  const parts: string[] = []
  for (const m of body.matchAll(FORM_RE)) for (const p of EMOTION_VISIBLE[m[1]].split('、')) if (!parts.includes(p)) parts.push(p)
  const who = body.match(/^[他她]/)?.[0] || ''
  const v = dedupeParts(parts.join('、'), ctx)
  return label + (v ? who + v : '')
}

/** Rewrite one prompt (idempotent). */
export function visualizePrompt(prompt: string): { prompt: string; rewrites: TextRewrite[] } {
  const rewrites: TextRewrite[] = []
  let emitted = ''
  const lines = prompt.split('\n').map((line) => {
    if (KEEP_LINE.test(line)) return line
    // a quoted line after a speech verb is spoken (audio), not drawn: 说：“…” → 开口说话，嘴唇开合
    let l = line.replace(SPEECH_QUOTE_RE, (m) => {
      rewrites.push({ kind: 'quote', from: m, to: '开口说话，嘴唇开合' })
      return '开口说话，嘴唇开合'
    })
    l = l.replace(QUOTED_RE, (m) => {
      rewrites.push({ kind: 'quote', from: m, to: '' })
      return ''
    })
    l = l.replace(/[“”‘’「」『』"'《》]/g, '')
    const toks = l.match(/[^，,；;。]+[，,；;。]?|[，,；;。]/g) || []
    const out: string[] = []
    for (const tok of toks) {
      const sep = /[，,；;。]$/.test(tok) ? tok.slice(-1) : ''
      const clause = sep ? tok.slice(0, -1) : tok
      if (INNER_RE.test(clause)) {
        // keep only a label before the marker (0–2秒，正常节奏：); 他暗想：… goes entirely
        const at = clause.search(INNER_RE)
        const k = Math.max(clause.lastIndexOf('：', at), clause.lastIndexOf(':', at))
        rewrites.push({ kind: 'inner', from: clause.slice(k + 1), to: '' })
        if (k >= 0) out.push(clause.slice(0, k + 1) + sep)
        else if (/[。；;]/.test(sep) && out.length) out[out.length - 1] = out[out.length - 1].replace(/[，,]$/, sep)
        continue
      }
      const nc = rewriteClause(clause, prompt.replace(clause, '') + emitted)
      if (nc !== clause) {
        rewrites.push({ kind: 'emotion', from: clause, to: nc })
        emitted += `|${nc}`
      }
      if (!nc.replace(/^[^：:]*[：:]/, '').trim() && !/[：:]$/.test(nc)) {
        // nothing visible left: drop the clause, its sentence end moves back
        if (/[。；;]/.test(sep) && out.length) out[out.length - 1] = out[out.length - 1].replace(/[，,]$/, sep)
        continue
      }
      out.push(nc + sep)
    }
    return out.join('').replace(/[，,]{2,}/g, '，').replace(/[，,]([。；;])/g, '$1').replace(/([：:])[，,]/g, '$1')
  })
  return { prompt: lines.join('\n'), rewrites }
}

/** Gate: what in a final prompt the video model could draw as text (quote marks, emotion words, inner monologue). */
export function promptTextRisks(prompt: string): string[] {
  const out: string[] = []
  const body = prompt.split('\n').filter((l) => !KEEP_LINE.test(l)).join('\n')
  const q = prompt.match(new RegExp(QUOTE_RE.source, 'g'))
  if (q) out.push(`quote ${[...new Set(q)].join('')}`)
  const e = body.match(new RegExp(EMOTION_RE.source, 'g'))
  if (e) out.push(`emotion ${[...new Set(e)].join('/')}`)
  const i = body.match(new RegExp(INNER_RE.source, 'g'))
  if (i) out.push(`inner ${[...new Set(i)].join('/')}`)
  return out
}

/** renderReview note prefixes (repack-report emotionRewrites parses them back) */
export const REWRITE_NOTE: Record<TextRewrite['kind'], string> = {
  emotion: '情绪词改为可见动作：',
  inner: '删去心理活动：',
  quote: '删去引号内容：',
}
export const REWRITE_ARROW = ' → '
export function rewriteNote(r: TextRewrite): string {
  return `${REWRITE_NOTE[r.kind]}${r.from}${REWRITE_ARROW}${r.to || '（删去）'}`
}
export function parseRewriteNote(n: string): TextRewrite | null {
  for (const [kind, pre] of Object.entries(REWRITE_NOTE) as [TextRewrite['kind'], string][]) {
    if (!n.startsWith(pre)) continue
    const [from, to] = n.slice(pre.length).split(REWRITE_ARROW)
    return { kind, from, to: to === '（删去）' ? '' : to }
  }
  return null
}
