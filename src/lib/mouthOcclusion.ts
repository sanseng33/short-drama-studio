/**
 * Mouth / face occlusion during a spoken line breaks lip-sync (the model hides the mouth, LatentSync has nothing to
 * drive). Generic table: inside a lip-sync segment (and the whole prompt of a closeup_dialogue shot without a timeline)
 * an occluding action is rewritten to a visible equivalent when one exists (手拢在嘴边喊 → 仰头张嘴喊), else dropped.
 * Outside the line's time range such actions stay.
 */

/** rewrites: occluding gesture → the same intent with the mouth visible */
export const MOUTH_REWRITES: [RegExp, string][] = [
  [/(?:一只手|一手|单手|双手|两手|手掌?)?(?:拢在嘴边|拢成喇叭状?|拢住嘴|圈在嘴边|放在嘴边|搭在嘴边)(?:大声)?(?:喊话|喊)?/, '仰起头、下巴前伸张大嘴喊'],
  [/(?:捂|掩)着?嘴(?:偷)?笑/, '咧嘴笑'],
]
/** occluders (mouth / face hidden) — dropped when no rewrite applies */
export const MOUTH_OCCLUDERS = [
  '(?:捂|掩|遮|挡)住?[^，、]{0,3}(?:嘴|口|脸)',
  '拢在嘴边', '拢住嘴', '手背(?:抹|擦|蹭)[^，、]{0,2}嘴', '托腮遮嘴', '手托[^，、]{0,3}遮',
  '手指?抵[^，、]{0,2}唇', '咬[^，、]{0,2}(?:手指|指甲|笔|吸管|指节|拳头)', '喝水', '喝一口', '抿一口', '吃',
  '打哈欠', '哈欠', '口罩', '(?:衣领|领口|围巾|帽檐|兜帽)[^，、]{0,4}(?:遮|挡|盖|埋)', '脸埋', '埋头', '埋进',
  '低头', '垂下头', '背对镜头', '背过身', '转过身去', '扭过脸去', '别过脸', '侧过脸去',
]
export const MOUTH_BLOCK_RE = new RegExp(`(?:${MOUTH_OCCLUDERS.join('|')})`)
/** marker of the lip-sync cue in a timeline line (beatPrompt BEAT_MOUTH_CLEAR contains it) */
export const MOUTH_CLEAR_MARK = '嘴部清晰可见'

/** one clause: rewritten, or its occluding parts dropped (null = nothing left) */
export function clearMouthClause(c: string): { clause: string | null; changed: boolean } {
  let x = c
  for (const [re, to] of MOUTH_REWRITES) x = x.replace(re, to)
  if (!MOUTH_BLOCK_RE.test(x)) return { clause: x, changed: x !== c }
  const parts = x.split('、').filter((p) => !MOUTH_BLOCK_RE.test(p))
  return { clause: parts.length ? parts.join('、') : null, changed: true }
}

const PROTECTED = /^(?:主体|镜头|光线|风格|限制|景别)[：:]|^画面中没有任何文字|^竖屏/
const BEAT_LINE = /^(\d+(?:\.\d+)?[–-]\d+(?:\.\d+)?秒[^：:]*[：:])(.*)$/

function clearText(t: string, notes: string[]): string {
  const out: string[] = []
  for (const tok of t.match(/[^，,。]+[，,。]?/g) || []) {
    const sep = /[，,。]$/.test(tok) ? tok.slice(-1) : ''
    const c = sep ? tok.slice(0, -1) : tok
    const r = clearMouthClause(c)
    if (r.changed) notes.push(`台词期间去掉遮挡嘴部的动作：${c} → ${r.clause ?? '（删去）'}`)
    if (r.clause) out.push(r.clause + sep)
    else if (sep === '。' && out.length) out[out.length - 1] = out[out.length - 1].replace(/[，,]$/, '。')
  }
  return out.join('')
}

/** lip-sync timeline lines (and, with wholeShot, every action line) lose mouth occluders */
export function clearMouth(prompt: string, opts: { wholeShot?: boolean } = {}): { prompt: string; notes: string[] } {
  const notes: string[] = []
  const lines = prompt.split('\n').map((l) => {
    const m = l.match(BEAT_LINE)
    if (m && l.includes(MOUTH_CLEAR_MARK)) {
      // the speaking cue itself (…无遮挡) is never touched
      const parts = m[2].split('；').map((p) => (p.includes(MOUTH_CLEAR_MARK) ? p : clearText(p, notes)))
      return m[1] + parts.filter((p, i) => p || i === 0).join('；')
    }
    if (opts.wholeShot && !m && !PROTECTED.test(l)) return clearText(l, notes)
    return l
  })
  return { prompt: lines.join('\n'), notes }
}

/** gate: occluders left inside the line's time range */
export function mouthOcclusionRisks(prompt: string, wholeShot = false): string[] {
  const out: string[] = []
  for (const l of prompt.split('\n')) {
    const m = l.match(BEAT_LINE)
    const parts = m && l.includes(MOUTH_CLEAR_MARK) ? m[2].split('；').filter((p) => !p.includes(MOUTH_CLEAR_MARK)) : wholeShot && !m && !PROTECTED.test(l) ? [l] : []
    for (const p of parts) for (const c of p.split(/[，,。、]/)) if (MOUTH_BLOCK_RE.test(c)) out.push(c)
  }
  return out
}
