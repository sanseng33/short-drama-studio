/**
 * Action density for beat segments (H3 render test: inside a ~2 s 【快】 segment only ONE distinct physical action is
 * executed, the rest is dropped). Caps: 【快】 1 main action; 【慢】 / 【恢复常速】 2; a dialogue segment 1 besides speaking.
 *
 * Clause weights (per comma clause, after expanding A又/再B compounds):
 *   3 head / body moves (扭头、转身、侧过头、站起、走到…)       2 large gestures (抬手、摊手、拉开、扔、撑在…)
 *   1 small hand business (摸、敲、扯、拨、按、写…)           0 modifiers — micro facial expression, gaze, breathing,
 *   held states (纹丝不动、手还搭在…), the completion of the previous move (转回来、收回), speech, events (石子打在玻璃上)
 * Modifiers are never counted or trimmed. Over-cap: drop lowest-weight mains (快/常速: earliest on ties; 台词段: latest
 * on ties — keep the action closest to speech). A pure return clause right after a dropped action is dropped with it.
 */
export type SegKind = '快' | '慢' | '恢复常速'

const STATE = /(纹丝不动|一动不动|没动|不动|站定|停在半空|悬在半空|没收回|没放下|还搭在|还悬|还抱着|还攥着|还挂着|僵住|顿住|扒着|攥着|夹着|握着|抱着|捏着)/
/** negated move: 没抬头 / 窗帘没有拉上 / 不闪躲 */
const NEG = /(没|没有|不|未)[^，]?(抬|回|扭|转|低|动|拉|摸|敲|看|起|放|躲|闪)/
const RETURN = /^(?:随后|再|又|然后)?(?:迅速|飞快地?|慢慢)?(?:转回|收回|缩回|放回|放下|松开|收了收)/
const BIG = /(扭头|转身|转过身|回头|回过头|侧过头|侧头看|侧身|站起|起身|坐下|坐直|坐起|弹起|走到|走向|走过|走回|冲向|冲进|冲出|冲过去|(?<!带)跑|扑向|扑过去|扑到|跳起|蹲下|躺|趴|仰头|仰起头|低下头|抬起头|抬头|探出|探身|俯身|弯腰|后退|退后|上前|凑近)/
const GESTURE = /(抬手|摊手|摊了摊手|摊开|伸手|挥手|挥了|指向|指了指|点了点|拉开|拉上|拉到|一把拉|拽|扔|抛|甩出|甩了|甩手|砸向|砸过去|推开|撑在|手撑|撑着栏杆|撑着桌|拍了|拍桌|举起|举高|抓起|抱紧|抱得更紧|压住|藏到|抽出|捂住|叉腰|攥紧|攥得更紧|双手撑|双手抬|双手抱|双手插|张开手|靠在|靠向|倚在|往前倾|前倾|往后靠|往后仰)/
const SMALL = /(摸|敲|扯|拨|按|压平|捏起|捏了捏|搓|挠|虚点|点了一下|推了推|整理|拢成|拢了拢|写卷子|写字|写作业|在纸上写|划|翻看|翻了|扣住|收紧|握紧|提了提|拽了拽|蹭)/
const MICRO = /(眉|眼|视线|目光|嘴角|嘴唇|唇|鼻|喉结|下巴|下颌|颌|耳根|脸|表情|笑|皱|眯|眨|咬|抿|呼吸|口气|叹|愣|心虚|倔强|不服气|敷衍|镇定|平静|紧张|发烫|发热|微热|肩膀|瞳孔)/
const SPEECH = /(开口|说话|说台词|喊话|问话|出声|扬声|低声|说一句|说完|喊完|问完)/

function hasMain(c: string): boolean {
  return BIG.test(c) || GESTURE.test(c) || SMALL.test(c)
}

export function actionWeight(clause: string): number {
  const c = (clause || '').trim()
  if (!c) return 0
  if (NEG.test(c)) return 0
  if (STATE.test(c) && !hasMain(c)) return 0
  // manner modifier: 甩臂时嘴角咬紧 / 转头时下颌绷紧 — only when neither half has a main action
  const k = c.lastIndexOf('时')
  if (k > 0) {
    const after = c.slice(k + 1)
    if (MICRO.test(after) && !hasMain(after) && !hasMain(c.slice(0, k))) return 0
  }
  if (BIG.test(c)) return 3
  if (GESTURE.test(c)) return 2
  if (SMALL.test(c)) return 1
  // pure return / completion (no main-action keyword left after the checks above)
  if (RETURN.test(c)) return 0
  if (MICRO.test(c)) return 0
  if (SPEECH.test(c)) return 0
  return 0
}

export function actionCap(speed: SegKind, dialogue: boolean): number {
  return speed === '快' || dialogue ? 1 : 2
}

/**
 * Expand "A又B" / "A再B" when both sides carry a main action (e.g. 摊手又收回来摸了摸后颈 → two clauses).
 * Leaves "又迅速转回正面" alone when the right side is a pure return.
 */
export function expandCompounds(cls: string[]): string[] {
  return cls.flatMap((c) => {
    const m = c.match(/^(.*?)([又再])(.*)$/)
    if (!m) return [c]
    const a = m[1].trim()
    const b = m[3].trim()
    if (!a || !b) return [c]
    if (actionWeight(a) > 0 && actionWeight(b) > 0) return [a, b]
    return [c]
  })
}

export type LimitOpts = { preferLater?: boolean }

/** Keep at most `cap` main actions; modifiers always stay, order preserved. */
export function limitActions(cls: string[], cap: number, opts: LimitOpts = {}): { kept: string[]; dropped: string[] } {
  const expanded = expandCompounds(cls)
  const preferLater = Boolean(opts.preferLater)
  const mains = expanded.map((c, i) => ({ i, w: actionWeight(c) })).filter((x) => x.w > 0)
  if (mains.length <= cap) return { kept: expanded, dropped: [] }
  const keep = new Set(
    [...mains]
      .sort((a, b) => (preferLater ? b.i - a.i || b.w - a.w : b.w - a.w || a.i - b.i))
      .slice(0, cap)
      .map((x) => x.i),
  )
  const dropIdx = new Set(mains.filter((x) => !keep.has(x.i)).map((x) => x.i))
  // a return / completion right after a dropped action goes with it
  expanded.forEach((c, i) => {
    if (i > 0 && dropIdx.has(i - 1) && RETURN.test(c.trim()) && actionWeight(c) === 0) dropIdx.add(i)
  })
  // "摊手又收回来摸了摸后颈" → drop 摊手, keep "摸了摸后颈" (strip connective return prefix)
  const polished = expanded.map((c, i) => {
    if (dropIdx.has(i) || i === 0 || !dropIdx.has(i - 1)) return c
    const m = c.trim().match(/^(?:迅速|飞快地?|慢慢)?(?:转回|收回|缩回|放回|放下|松开|收了收)(?:来|去|了)?(.+)$/)
    if (m && m[1] && actionWeight(m[1]) > 0) return m[1].replace(/^[的地得\s]+/, '') || m[1]
    return c
  })
  return { kept: polished.filter((_, i) => !dropIdx.has(i)), dropped: expanded.filter((_, i) => dropIdx.has(i)) }
}

export function countActions(cls: string[]): number {
  return expandCompounds(cls).filter((c) => actionWeight(c) > 0).length
}
