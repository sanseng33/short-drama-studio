/**
 * Final-render hygiene rules (generic word tables, no show data). All run inside renderPrompt, after the beat logic,
 * so beat-stage regexes (说完 / 安静听 …) keep working on the beat text:
 *  - caption-echo reduction: speech meta-words (说完 / 喊完 / 嘀咕 / 话音 / 画外有人说话 …) are echoed by the video model
 *    as burned-in captions → visual-time phrasing without 说 / 喊 / 问 (收声后 / 嘴唇开合 / 画外传来人声); the standard
 *    lip-sync cue 「正脸朝镜头开口说一句短话，嘴部清晰可见、无遮挡」 is kept as is;
 *  - first-line 「实拍画面，无字幕。」 and the lower-third band negative before the fixed no-text line;
 *  - empty shots (framing empty): acting fragments dropped, skin / face style words and wardrobe limits dropped,
 *    and a gate for person-acting tokens left in the final prompt;
 *  - subject carry: a subjectless motion segment (顺着…往下溜) inherits the last concrete object subject of the previous
 *    segment; an empty shot whose subject cannot be resolved is flagged (no subject is invented).
 */
import { CARRY_WARDROBE_CONSTRAINT } from './sceneContinuity'

export const FIRST_LINE_NO_TEXT = '实拍画面，无字幕。'
export const BAND_NEGATIVE = '画面下方三分之一干净，没有字幕条或对白字幕。'
/** the standard lip-sync cue keeps its 说 (one per spoken segment) */
const MOUTH_KEEP = '正脸朝镜头开口说一句短话'
const HEAD_RE = /^(竖屏9:16(?:，[\d.]+秒单镜)?。)/

/** 竖屏9:16，N秒单镜。 → 竖屏9:16，N秒单镜。实拍画面，无字幕。 (first line, once) */
export function withFirstLineNoText(prompt: string): string {
  const lines = prompt.split('\n')
  if (!HEAD_RE.test(lines[0]) || lines[0].includes(FIRST_LINE_NO_TEXT)) return prompt
  lines[0] = lines[0].replace(HEAD_RE, `$1${FIRST_LINE_NO_TEXT}`)
  return lines.join('\n')
}
export function stripFirstLineNoText(prompt: string): string {
  return prompt.split(FIRST_LINE_NO_TEXT).join('')
}

// ---------------- caption-echo reduction ----------------

/** [pattern, replacement]; applied in order, outside the standard lip-sync cue */
const CAPTION_RULES: [RegExp, string][] = [
  [/开口说话[，,]嘴唇开合/g, '嘴唇开合'],
  [/画外人声的说话人不出镜/g, '画外人声的来源不出镜'],
  [/画外有人说话/g, '画外传来人声'],
  [/嘴唇闭合不说话/g, '嘴唇闭合'],
  [/安静听对面说话/g, '安静听着对面'],
  [/((?:他|她)?)(?:说|喊|问|念|答|讲)完(?:这句话?|那句话?|这一句|话)?(?=[。；;]|$)/g, '$1收声'],
  [/(?:说|喊|问|念|答|讲)完(?:这句话?|那句话?|这一句|话)?(?:之后|以后|后)?[，,]?/g, '收声后'],
  [/说罢[，,]?|话音(?:刚落|落下)?(?:之后|以后|后)?[，,]?/g, '收声后'],
  [/说着说着/g, '渐渐'],
  [/(?:对着空气)?嘀咕(?:了|着)?(?:一句|一声|几句)?/g, '嘴唇小幅快速开合'],
  [/([才再])说话/g, '$1开口'],
  [/说话(?=前|之前|时)/g, '开口'],
  [/(?:张大?嘴|大声)喊(?:话)?|喊话/g, '张大嘴'],
  [/喊声|叫喊声/g, '人声'],
  [/问话/g, '下巴微抬、眉梢上挑'],
  [/开口说话/g, '开口'],
  [/说不清/g, '难以分辨'],
]
export const CAPTION_NOTE = '台词元词改写：'

export function speechChars(prompt: string): number {
  return (prompt.match(/说/g) || []).length
}

/** rewrite speech meta-words; notes = `台词元词改写：<from> → <to>` */
export function rewriteCaptionWords(prompt: string): { prompt: string; notes: string[] } {
  const seen = new Map<string, number>()
  const parts = prompt.split(MOUTH_KEEP)
  const out = parts.map((seg) => {
    let s = seg
    for (const [re, to] of CAPTION_RULES) {
      s = s.replace(re, (m: string, ...g: unknown[]) => {
        const rep = to.replace(/\$1/g, typeof g[0] === 'string' ? (g[0] as string) : '')
        const k = `${m} → ${rep}`
        seen.set(k, (seen.get(k) || 0) + 1)
        return rep
      })
    }
    // 收声后 directly before a sentence end / another 收声 reads as a stub
    return s
      .replace(/收声后([。；;])/g, '收声$1')
      .replace(/收声后收声后/g, '收声后')
      // 才开口，他开口 (a rewrite landing next to the same word): the second 开口 repeats the first
      .replace(/开口[，,](?:他|她)?开口(?=[，,。；;]|$)/g, '开口')
  })
  // one note per distinct rewrite, ×n when it happened n times (renderReview notes are de-duplicated)
  const notes = [...seen].map(([k, n]) => `${CAPTION_NOTE}${k}${n > 1 ? ` ×${n}` : ''}`)
  return { prompt: out.join(MOUTH_KEEP), notes }
}
/** parse a caption note back: from / to / times */
export function parseCaptionNote(note: string): { from: string; to: string; times: number } | null {
  if (!note.startsWith(CAPTION_NOTE)) return null
  const m = note.slice(CAPTION_NOTE.length).match(/^(.*) → (.*?)(?: ×(\d+))?$/)
  return m ? { from: m[1], to: m[2], times: m[3] ? Number(m[3]) : 1 } : null
}

// ---------------- empty-shot hygiene ----------------

/** acting / face / body tokens: never in an empty shot (person words are in shotAnnotate PERSON_RE) */
export const ACTING_RE =
  /挑眉|皱眉|眉头|眉毛|眉心|下巴|下颌|眼神|眼睛|眼皮|眼眶|眼角|眼睑|目光|视线|嘴角|嘴唇|嘴巴|抿嘴|撇嘴|张嘴|闭嘴|喉结|鼻翼|鼻子|耳根|瞳孔|脸颊|脸色|脸上|面色|神色|神情|表情|点头|摇头|低头|抬头|歪头|偏头|侧头|咬牙|叹气|呼吸|耸肩|肩膀|手指|指节|指尖|手掌|手腕|微笑|冷笑|苦笑|轻笑|笑了|开口|说话|不服/
export const EMPTY_SCRUB_NOTE = '空镜，删去人物表演：'
/** style parts about skin / faces (empty shot: nothing to render them on) */
const FACE_STYLE = /肤|毛孔|磨皮|打蜡|脸|五官|妆|发丝/
/** limit parts about wardrobe (empty shot) */
const WARDROBE_LIMIT = /服装|换装|着装|穿着|校徽|刺绣/
export const EMPTY_STYLE_NOTE = '空镜，删去肤质/服装约束：'
export const EMPTY_PROP_CARRY = '道具：保持与上一镜末帧一致，禁止引入定妆包道具除非上一镜已有'

/** empty shot: style line without skin / face words, limit line without wardrobe clauses (inline labels too) */
export function scrubEmptyStyle(prompt: string): { prompt: string; notes: string[] } {
  const notes: string[] = []
  let p = prompt.split(CARRY_WARDROBE_CONSTRAINT).join(EMPTY_PROP_CARRY)
  p = p.replace(/(风格[：:])([^。\n]*)/g, (_m, lab: string, body: string) => {
    const parts = body.split(/[，,]/)
    const kept = parts.filter((x) => !FACE_STYLE.test(x))
    if (kept.length < parts.length) notes.push(`${EMPTY_STYLE_NOTE}风格 ${parts.filter((x) => FACE_STYLE.test(x)).join('，')}`)
    return `${lab}${kept.join('，')}`
  })
  p = p.replace(/(限制[：:])([^。\n]*)/g, (_m, lab: string, body: string) => {
    const parts = body.split(/[；;]/)
    const kept = parts.filter((x) => !WARDROBE_LIMIT.test(x) || x.startsWith('道具：'))
    if (kept.length < parts.length) notes.push(`${EMPTY_STYLE_NOTE}限制 ${parts.filter((x) => !kept.includes(x)).join('；')}`)
    return `${lab}${kept.join('；')}`
  })
  if (p !== prompt && !notes.length) notes.push(`${EMPTY_STYLE_NOTE}限制 服装延续`)
  return { prompt: p, notes }
}

/** drawable lines checked by the empty-shot gate */
const GATE_SKIP = /^(?:风格|限制|景别|光线)[：:]|^画面中没有任何文字|^画面下方三分之一/
/** person words (mirrors shotAnnotate PERSON_RE, without importing it) */
const GATE_PERSON = /(?<!其)他|她|少年|少女|男生|女生|男人|女人|男孩|女孩|学生|有人/
/** empty shot gate: person / acting tokens in the final prompt (exit-4 class; also a render hold) */
export function emptyShotRisks(prompt: string): string[] {
  const out = new Set<string>()
  prompt.split('\n').forEach((l, i) => {
    if (GATE_SKIP.test(l)) return
    const body = (i === 0 ? l.replace(HEAD_RE, '') : l).replace(/无人物|没有人物|空镜|画面中无人|无人入画|不出现人物|靠[^，。；]*表现[^，。；]*/g, '')
    for (const m of body.matchAll(new RegExp(`${ACTING_RE.source}|${GATE_PERSON.source}`, 'g'))) out.add(m[0])
  })
  return [...out]
}

// ---------------- subject carry ----------------

const SEG_RE = /^(\d+(?:\.\d+)?–\d+(?:\.\d+)?秒，[^：\n]*：)(.*)$/
/** a segment body with no subject: it starts with a direction / path / bare motion */
const SUBJECTLESS = /^(?:随后|然后|接着|再|又|继续|一路)?(?:顺着|沿着|贴着|往[下上前后外里旁]|向[下上前后外里]|朝[下上]|滑|溜|掉|落|坠|弹|滚|飘|淌)/
/** object motion (a person shot carries only these) */
const OBJECT_MOTION = /溜|滑落|滑下|往下滑|掉|落下|坠|滚|飘|淌/
const LEAD = /^(?:随后|然后|接着|同时|这时|最后|再|又|也)/
/** subject = text before the first motion / impact / adverb */
const VERB_AT = /砰|啪|咚|哗|嗖|猛|重重|狠狠|轻轻|缓缓|慢慢|突然|忽然|一下|在|贴|砸|撞|落|掉|飞|滑|溜|弹|滚|翻|晃|炸|往|顺|被|从|向|朝|摔|挂|停|淌|流|飘|碎|裂|抖|震|压|盖|砸|立|躺|倒|转|卡|粘|沾|撒/
const BAD_SUBJECT = /^(?:靠|用|无|没有|画面|镜头|光|影|声)|纸页|页角|一角|表面|边缘|封面|边角|盖子|把手|提手|碎屑/
const PERSON_PART = /(?<!其)他|她|少年|少女|男|女|学生|人|手|脚|头|身|脸|眼|嘴|肩|指/
export const SUBJECT_CARRY_NOTE = '分段补主语：'
export const SUBJECT_UNRESOLVED_NOTE = '空镜分段主语不明：'

function subjectOf(clause: string): string | null {
  const c = clause.trim().replace(LEAD, '')
  for (let k = 1; k <= Math.min(6, c.length - 1); k++) {
    if (VERB_AT.test(c.slice(k, k + 2)[0]) || /^(?:重重|狠狠|轻轻|缓缓|慢慢|突然|忽然|一下)/.test(c.slice(k))) {
      const s = c.slice(0, k)
      return BAD_SUBJECT.test(s) || /[，,。；;：:、的了着]/.test(s) ? null : s
    }
  }
  return null
}

/** prepend the previous segment's last concrete object subject to a subjectless motion segment */
export function carrySegmentSubjects(prompt: string, empty: boolean): { prompt: string; notes: string[] } {
  const notes: string[] = []
  const lines = prompt.split('\n')
  let prev: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SEG_RE)
    if (!m) continue
    const body = m[2]
    const first = body.split(/[，,。；;]/)[0]
    if (prev !== null && SUBJECTLESS.test(first) && (empty || OBJECT_MOTION.test(first))) {
      const clauses = prev.split(/[，,。；;]/).filter(Boolean).reverse()
      let subj: string | null = null
      for (const c of clauses) {
        const s = subjectOf(c)
        if (s && !(PERSON_PART.test(s))) {
          subj = s
          break
        }
      }
      if (subj) {
        lines[i] = `${m[1]}${subj}${body.replace(LEAD, '')}`
        notes.push(`${SUBJECT_CARRY_NOTE}${first} ← ${subj}`)
      } else if (empty) notes.push(`${SUBJECT_UNRESOLVED_NOTE}${first}`)
    }
    prev = (lines[i].match(SEG_RE) || m)[2]
  }
  return { prompt: lines.join('\n'), notes }
}

// ---------------- adjacent-segment time phrase ----------------

const TIME_LEAD = /^((?:他|她)?(?:收声|停下|闭上嘴|安静下来|停住|回过神)(?:之后|以后|后))[，,]?/
export const TIME_REPEAT_NOTE = '相邻分段重复时间短语，删去：'
/**
 * A segment that starts with the same time phrase (收声后 …) the previous segment already used: the phrase goes
 * (the cut between segments already says "after"); the segment keeps its own action.
 */
export function dropRepeatedTimeLead(prompt: string): { prompt: string; notes: string[] } {
  const notes: string[] = []
  const lines = prompt.split('\n')
  let prev: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SEG_RE)
    if (!m) continue
    const lead = m[2].match(TIME_LEAD)
    const phrase = lead?.[1].replace(/^(?:他|她)/, '').replace(/(?:之后|以后)$/, '后')
    if (lead && prev !== null && phrase && prev.includes(phrase) && m[2].length > lead[0].length + 1) {
      lines[i] = `${m[1]}${m[2].slice(lead[0].length)}`
      notes.push(`${TIME_REPEAT_NOTE}${lead[1]}`)
    }
    prev = (lines[i].match(SEG_RE) || m)[2]
  }
  return { prompt: lines.join('\n'), notes }
}

// ---------------- abstract performance backstop ----------------

export const ABSTRACT_PERF_NOTE = '抽象表演改写：'
/**
 * Final pass backstop for 「神情透出<phrase>」 (any source): the phrase's visible acting from the emotion table, else
 * the clause is dropped; a timeline segment left with no visible text gets the held expression.
 */
export function rewriteAbstractPerformance(prompt: string, visible: (phrase: string, avoid: string) => string, hold: string): { prompt: string; notes: string[] } {
  const notes: string[] = []
  const lines = prompt.split('\n').map((line) => {
    if (!line.includes('神情透出') || /^(?:风格|限制|景别)[：:]/.test(line)) return line
    let out = line.replace(/([，,；;：:]?)神情透出([^，,。；;\n]*)/g, (_m, sep: string, ph: string) => {
      const v = visible(ph, line)
      notes.push(`${ABSTRACT_PERF_NOTE}神情透出${ph} → ${v || '（删去）'}`)
      return v ? `${sep}${v}` : /[：:]/.test(sep) ? sep : ''
    })
    out = out.replace(/[，,]{2,}/g, '，').replace(/[，,]([。；;])/g, '$1').replace(/([：:])[，,]/g, '$1')
    const m = out.match(SEG_RE)
    if (m) {
      const [visual, ...cue] = m[2].split('；')
      if (!visual.replace(/^动作放慢[，,]?/, '').replace(/[。，,\s]+$/, '')) out = `${m[1]}${/^动作放慢/.test(visual) ? '动作放慢，' : ''}${hold}${cue.length ? `；${cue.join('；')}` : '。'}`
    }
    return out
  })
  return { prompt: lines.join('\n'), notes }
}
