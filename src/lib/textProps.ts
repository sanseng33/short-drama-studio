/**
 * Text-bearing props (generic word table, no show data): objects whose real-world surface carries print or a UI —
 * magazines, books, exam papers, notes, signs, packaging, labels, screens, boards, plates, cards, banknotes. The video
 * model fills such a surface with fake glyphs (OCR reject). Final render pass:
 *  - the first drawable mention of each prop is qualified in place with a blank-surface phrase (杂志 → 封面纯色无字的杂志);
 *  - a signage prop that is only a set-dressing item of an 环境陈设 list is dropped instead;
 *  - a screen mentioned only as a light source (屏幕的光 / 手机微光, or in the 光线 line) is not qualified;
 *  - one consolidated per-shot negative line names every prop present (杂志封面与纸页空白无印刷；…).
 * Idempotent (an already qualified mention is recognised; the negative line is recognised and rebuilt).
 */

export type TextPropKind = 'print' | 'sign' | 'screen'

export interface TextPropEntry {
  /** surface words of the prop (longest match wins across the table) */
  names: string[]
  /** blank-surface qualifier written before the noun as 「<q>的<noun>」 */
  q: string
  /** negative clause; {n} = the noun as written */
  neg: string
  kind: TextPropKind
  /** guards on the char before / after the noun (纸巾 is not paper, 书包 is not a book) */
  notBefore?: RegExp
  notAfter?: RegExp
  /** the noun only counts when followed by this (纸 → 纸上 / 纸面) */
  onlyAfter?: RegExp
}

export const TEXT_PROPS: TextPropEntry[] = [
  { names: ['杂志'], q: '封面纯色无字', neg: '{n}封面与纸页空白无印刷', kind: 'print' },
  { names: ['报纸'], q: '版面空白无字', neg: '{n}版面空白无印刷', kind: 'print' },
  { names: ['课本', '教科书', '作业本', '练习本', '笔记本', '本子', '练习册'], q: '封面纯色、内页空白', neg: '{n}封面与内页空白无字', kind: 'print', notAfter: /^电脑/ },
  { names: ['书'], q: '封面纯色、内页空白', neg: '{n}封面与内页空白无字', kind: 'print', notBefore: /[秘证情遗说明全背文]$/, notAfter: /^[包桌架柜房店法写签记生香面皮]/ },
  { names: ['练习卷', '试卷', '卷子', '考卷', '答题卡', '成绩单', '作业纸'], q: '纸面空白', neg: '{n}纸面空白无印刷', kind: 'print' },
  { names: ['纸条', '便签', '便利贴', '小纸片'], q: '空白无字', neg: '{n}空白无字', kind: 'print' },
  { names: ['纸'], q: '空白', neg: '纸面空白，没有可辨认的字迹', kind: 'print', notBefore: /[巾卷报草砂锡油手]$/, onlyAfter: /^(?:上|面)/ },
  { names: ['信封', '信纸', '情书'], q: '空白无字', neg: '{n}空白无字', kind: 'print' },
  { names: ['名片', '卡片', '贺卡', '证件', '工牌', '胸牌', '学生证', '准考证'], q: '空白无字', neg: '{n}空白无字', kind: 'print' },
  { names: ['钞票', '纸币'], q: '图案模糊', neg: '{n}看不清面额与图案', kind: 'print' },
  { names: ['菜单', '价目表', '传单', '宣传单'], q: '纯色无字', neg: '{n}纯色无字', kind: 'sign' },
  { names: ['海报', '招牌', '店招', '横幅', '标语', '灯牌', '广告牌', '指示牌', '路牌', '门牌', '牌匾', '告示'], q: '无字纯色', neg: '{n}无字纯色', kind: 'sign' },
  { names: ['车牌'], q: '空白', neg: '{n}空白无字', kind: 'sign' },
  { names: ['包装盒', '包装袋', '快递盒', '快递箱', '外卖袋', '快递', '包装'], q: '纯色无字', neg: '{n}纯色无字', kind: 'print' },
  { names: ['瓶身', '饮料瓶', '矿泉水瓶', '标签'], q: '无标签', neg: '{n}无标签无字', kind: 'print' },
  { names: ['塑料杯', '纸杯', '饮料杯', '咖啡杯'], q: '杯身纯色无印花', neg: '{n}杯身纯色无印花', kind: 'print' },
  { names: ['扫码盒', '收款码', '二维码'], q: '表面纯色无图案', neg: '{n}表面纯色无图案', kind: 'print' },
  { names: ['手机屏幕', '屏幕', '显示屏', '显示器'], q: '无界面', neg: '{n}只有柔和的光、无界面无文字', kind: 'screen' },
  { names: ['手机', '电脑', '平板', '电视', '笔记本电脑'], q: '屏幕无界面', neg: '{n}屏幕只有柔和的光、无界面', kind: 'screen' },
  { names: ['黑板', '白板'], q: '空白', neg: '{n}空白无字', kind: 'sign' },
]

export interface TextPropHit {
  /** the noun as written */
  name: string
  kind: TextPropKind
  /** qualified in place / postposed (「（杂志封面纯色无字）」 at the clause end, no double 的) / dropped from a set-dressing list / named only in the negative line */
  mode: 'qualified' | 'postposed' | 'dropped' | 'negOnly'
  /** a later mention that is another object of the same kind (一部手机) */
  instance?: boolean
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ALL = TEXT_PROPS.flatMap((e) => e.names.map((n) => ({ n, e }))).sort((a, b) => b.n.length - a.n.length)
const NOUN_RE = new RegExp(ALL.map((x) => esc(x.n)).join('|'), 'g')
/** lines never qualified (style / limits / framing / fixed no-text / band negative) */
const SKIP_LINE = /^(?:风格|限制|景别)[：:]|^画面中没有任何文字|^画面下方三分之一/
/** lines where a prop is light / atmosphere only: listed in the negative line, not qualified */
const LIGHT_LINE = /^光线[：:]/
/** a screen used as a light source (屏幕的光 / 手机微光 / 屏幕冷光) */
const LIGHT_FORM = /^的?(?:微|冷|蓝|白|亮|柔|荧)?光/
/** the noun's own modifiers the qualifier goes in front of (卷边旧杂志 → 封面纯色无字的卷边旧杂志) */
const MODIFIER = /[旧新破皱薄厚大小长短红白黑蓝绿黄灰粉彩卷边折角湿软硬空满整散碎]/

export const negFor = (e: TextPropEntry, name: string) => e.neg.split('{n}').join(name)
const QUALIFIERS = [...new Set(TEXT_PROPS.map((e) => e.q))]
const NEG_SET = new Set(ALL.map((x) => negFor(x.e, x.n)))
/** is this the consolidated per-shot negative line written by qualifyTextProps */
export function isPropNegLine(line: string): boolean {
  const parts = line.trim().replace(/。$/, '').split('；')
  return parts.length > 0 && parts.every((p) => NEG_SET.has(p))
}

interface Match {
  line: number
  at: number
  name: string
  e: TextPropEntry
}

/** every table noun in the drawable lines (guards applied; longest match) */
export function findTextProps(lines: string[]): Match[] {
  const out: Match[] = []
  lines.forEach((l, li) => {
    if (SKIP_LINE.test(l) || isPropNegLine(l)) return
    for (const m of l.matchAll(NOUN_RE)) {
      const hit = ALL.find((x) => x.n === m[0])!
      const before = l.slice(0, m.index)
      const after = l.slice(m.index! + m[0].length)
      if (hit.e.notBefore?.test(before) || hit.e.notAfter?.test(after)) continue
      if (hit.e.onlyAfter && !hit.e.onlyAfter.test(after)) continue
      // inside a qualifier this table wrote (屏幕无界面的手机 / 纸面空白的卷子): not a prop mention
      const open = l.lastIndexOf('（', m.index!)
      const close = l.indexOf('）', m.index!)
      if (open >= 0 && close > open && !l.slice(open, m.index!).includes('）') && POSTPOSED.has(l.slice(open, close + 1))) continue
      if (QUALIFIERS.some((q) => {
        const k = q.indexOf(m[0])
        return k >= 0 && l.slice(m.index! - k, m.index! - k + q.length + 1) === `${q}的`
      })) continue
      out.push({ line: li, at: m.index!, name: m[0], e: hit.e })
    }
  })
  return out
}

/** insertion point of the qualifier: walk back over the noun's own modifiers (≤ 4 chars) */
function insertAt(line: string, at: number): number {
  let j = at
  while (j > 0 && at - j < 4 && MODIFIER.test(line[j - 1])) j--
  return j
}

/** the 环境陈设 list item (、-separated) containing position `at`, when the line has such a list */
function setDressingItem(line: string, at: number): [number, number] | null {
  const k = line.lastIndexOf('环境陈设', at)
  if (k < 0) return null
  const end = line.slice(k).search(/[。\n]/)
  if (end >= 0 && k + end < at) return null
  const seg0 = line.slice(0, at).search(/[、，：:][^、，：:]*$/)
  const s = seg0 >= k ? seg0 + 1 : k
  const e0 = line.slice(at).search(/[、，。；]/)
  const e = e0 >= 0 ? at + e0 : line.length
  return [s, e]
}

/** a later mention that is clearly another object of the same kind (一部手机 after 手机 / 另一本书) */
const DISTINCT_BEFORE = /(?:另一|又一|[一两三几另])[部台本张份只个块支封把件条片沓叠摞]$|(?:别人|旁人|对方)的$|另外的?$/
/** text before the mention's modifiers, without a 「q的」 this table wrote */
function beforeMention(line: string, m: Match): string {
  const b = line.slice(0, insertAt(line, m.at))
  return b.endsWith(`${m.e.q}的`) ? b.slice(0, -m.e.q.length - 1) : b
}
/** postposed form (no double 的): 捏着杂志的手停在半空（杂志封面纯色无字） */
const postposed = (name: string, e: TextPropEntry) => `（${name}${e.q}）`
const POSTPOSED = new Set(ALL.map((x) => postposed(x.n, x.e)))

/** how the mention is already qualified (prefix 「q的」 before its modifiers, or a postposed note in the clause) */
function qualMode(line: string, m: Match): 'qualified' | 'postposed' | null {
  const k = insertAt(line, m.at)
  if (line.slice(Math.max(0, k - m.e.q.length - 1), k) === `${m.e.q}的`) return 'qualified'
  const end = clauseEnd(line, m.at)
  const p = postposed(m.name, m.e)
  return line.slice(Math.max(0, end - p.length), end) === p ? 'postposed' : null
}
/** end of the clause containing `at` (next ，。；, a postposed note stays inside) */
function clauseEnd(line: string, at: number): number {
  const r = line.slice(at).search(/[，,。；;]/)
  return r >= 0 ? at + r : line.length
}
/**
 * Qualify one mention in place (「q的」 before the noun's modifiers); when that would read 「…的…的」 — the noun is a
 * modifier itself (杂志的手) or already follows a 的-modifier (散开的卷子) — the qualifier is postposed at the clause end.
 */
function qualifyOne(lines: string[], m: Match): 'qualified' | 'postposed' {
  const l = lines[m.line]
  const k = insertAt(l, m.at)
  const afterNoun = l.slice(m.at + m.name.length)
  if (afterNoun.startsWith('的') || l[k - 1] === '的') {
    const end = clauseEnd(l, m.at)
    lines[m.line] = `${l.slice(0, end)}${postposed(m.name, m.e)}${l.slice(end)}`
    return 'postposed'
  }
  lines[m.line] = `${l.slice(0, k)}${m.e.q}的${l.slice(k)}`
  return 'qualified'
}

/**
 * Qualify the text props of one prompt. Returns the rewritten prompt (lines; the negative line is NOT appended —
 * renderPrompt places it), the negative line ('' when no prop), and one hit per qualified / noted mention.
 */
export function qualifyTextProps(prompt: string): { prompt: string; negLine: string; hits: TextPropHit[] } {
  const lines = prompt.split('\n').filter((l) => !isPropNegLine(l))
  const hits: TextPropHit[] = []
  const seen = new Map<string, TextPropHit>()
  const drawable = (x: Match) => !LIGHT_LINE.test(lines[x.line]) && !(x.e.kind === 'screen' && LIGHT_FORM.test(lines[x.line].slice(x.at + x.name.length)))
  const after = (x: Match, m: Match) => x.line > m.line || (x.line === m.line && x.at > m.at)
  // first drawable mention per noun; a later mention is qualified too only when it is clearly another object
  for (let pass = 0; pass < 64; pass++) {
    const ms = findTextProps(lines).filter((m) => !seen.has(m.name))
    if (!ms.length) break
    const m = ms[0]
    const l = lines[m.line]
    let mode: TextPropHit['mode']
    // the same qualifier already written for another noun (书 … 课本): once is enough, the negative line names both
    const sameQ = hits.some((h) => (h.mode === 'qualified' || h.mode === 'postposed') && h.name !== m.name && TEXT_PROPS.find((e) => e.names.includes(h.name))?.q === m.e.q)
    let first: Match | null = m
    if (sameQ) {
      mode = 'negOnly'
      first = null
    } else if (!drawable(m)) {
      // a screen as light / the 光线 line: a later drawable mention may still need the qualifier
      first = findTextProps(lines).find((x) => x.name === m.name && after(x, m) && drawable(x)) || null
      mode = 'negOnly'
    } else {
      const item = m.e.kind === 'sign' ? setDressingItem(l, m.at) : null
      if (item) {
        const [s0, e0] = item
        lines[m.line] = (l.slice(0, s0) + l.slice(e0)).replace(/、{2,}/g, '、').replace(/([：:，,])、/g, '$1').replace(/、([。，；])/g, '$1').replace(/([：:])([。])/g, '$1')
        mode = 'dropped'
        first = null
      } else mode = 'qualified'
    }
    if (first) {
      const had = qualMode(lines[first.line], first)
      mode = had || qualifyOne(lines, first)
      // an in-place qualifier just written shifts the mention
      if (!had && mode === 'qualified') first = { ...first, at: first.at + first.e.q.length + 1 }
    }
    const h: TextPropHit = { name: m.name, kind: m.e.kind, mode }
    seen.set(m.name, h)
    hits.push(h)
    // later separate objects of the same kind (一部手机 …): each qualified, one hit each
    if (first) {
      const f = first
      const instances = () => findTextProps(lines).filter((x) => x.name === m.name && after(x, f) && drawable(x) && DISTINCT_BEFORE.test(beforeMention(lines[x.line], x)))
      for (let guard = 0; guard < 16; guard++) {
        const next = instances().find((x) => !qualMode(lines[x.line], x))
        if (!next) break
        qualifyOne(lines, next)
      }
      for (const x of instances()) hits.push({ name: m.name, kind: m.e.kind, mode: qualMode(lines[x.line], x) || 'qualified', instance: true })
    }
  }
  // a dropped set-dressing sign mentioned nowhere else needs no negative; every other prop is named once
  // a device's own negative (手机屏幕只有柔和的光…) covers a bare 屏幕 / 显示屏 mention
  const qOf = (name: string) => TEXT_PROPS.find((e) => e.names.includes(name))?.q
  const device = hits.some((h) => h.kind === 'screen' && qOf(h.name) === '屏幕无界面')
  const negs = [
    ...new Set(
      hits
        .filter((h) => !(device && h.kind === 'screen' && qOf(h.name) === '无界面'))
        .filter((h) => h.mode !== 'dropped' || findTextProps(lines).some((x) => x.name === h.name))
        .map((h) => negFor(ALL.find((x) => x.n === h.name)!.e, h.name)),
    ),
  ]
  return { prompt: lines.join('\n'), negLine: negs.length ? `${negs.join('；')}。` : '', hits }
}

/** renderReview note prefix (repack-report textProps parses it) */
export const TEXT_PROP_NOTE = '文字道具表面留白：'
export function textPropNote(h: TextPropHit): string {
  const how = h.mode === 'qualified' ? '就地限定' : h.mode === 'postposed' ? '后置限定' : h.mode === 'dropped' ? '陈设删去' : '仅负面约束'
  return `${TEXT_PROP_NOTE}${h.name}（${h.instance ? '另一件，' : ''}${how}）`
}
