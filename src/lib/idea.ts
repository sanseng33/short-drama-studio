/** 从想法一键生成：LLM 结构化抽取 + 无 Key 启发式兜底 */
import type { ArtStyle, Character, EpisodeOutline, Genre } from '../types'
import { chatCompletion } from './llm'
import type { LlmSettings } from '../types'

export const IDEA_MAX_CHARS = 2000

/** Count user-visible characters (code points), so 中文/emoji each count as 1. */
export function countChars(s: string): number {
  return Array.from(s).length
}

export const KNOWN_GENRES: Genre[] = ['男频玄幻', '都市逆袭', '都市重生', '古风女频重生', '大女主']
export const KNOWN_STYLES: ArtStyle[] = ['2D国风', '2D日漫', '真人都市']

export interface IdeaCharacter {
  name: string
  role: string
  tags: string[]
  appearance: string
  personality: string
  arc: string
}

export interface IdeaEpisode {
  title: string
  summary: string
  hook: string
}

export interface IdeaResult {
  title: string
  genre: string
  artStyle: string
  logline: string
  world: string
  characters: IdeaCharacter[]
  episodes: IdeaEpisode[]
}

export const IDEA_SYSTEM = `你是资深AI短剧/漫剧策划。用户会给出一段自由格式的剧本想法。请把它整理成严格 JSON 对象（不要markdown围栏、不要任何解释文字），字段：
{
 "title": "剧名",
 "genre": "优先从 ${KNOWN_GENRES.join(' / ')} 中选最接近的；都不贴切就写自定义题材名",
 "artStyle": "必须是 ${KNOWN_STYLES.join(' / ')} 之一",
 "logline": "一句话故事",
 "world": "世界观/背景设定，2-4句",
 "characters": [{"name":"","role":"自由定位，如主角/对手/导师","tags":["protagonist|antagonist|support|mentor|romantic|deuteragonist 中选"],"appearance":"外貌+服装视觉锁定，适合AI绘图","personality":"性格","arc":"人物弧光"}],
 "episodes": [{"title":"","summary":"本集剧情2-3句","hook":"开场3秒钩子或结尾悬念"}]
}
规则：角色 1-8 个，只写想法中明确出现或强烈暗示的角色，不要强行补齐男主/女主/反派。集数按想法体量合理决定（通常 3-12 集，想法很短时 3-5 集）。全部中文。`

/** Strip code fences / leading prose and parse the first JSON object. */
export function parseIdeaJson(text: string): IdeaResult {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('LLM 返回中未找到 JSON 对象')
  t = t.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')
  const raw = JSON.parse(t) as Partial<IdeaResult>
  return normalizeIdea(raw)
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v.trim() : v == null ? d : String(v))

export function normalizeIdea(raw: Partial<IdeaResult>): IdeaResult {
  const chars = (Array.isArray(raw.characters) ? raw.characters : [])
    .map((c) => ({
      name: str(c?.name),
      role: str(c?.role, '角色'),
      tags: Array.isArray(c?.tags) ? c.tags.map((x) => str(x)).filter(Boolean) : [],
      appearance: str(c?.appearance),
      personality: str(c?.personality),
      arc: str(c?.arc),
    }))
    .filter((c) => c.name)
    .slice(0, 8)
  const eps = (Array.isArray(raw.episodes) ? raw.episodes : [])
    .map((e, i) => ({
      title: str(e?.title, `第${i + 1}集`) || `第${i + 1}集`,
      summary: str(e?.summary),
      hook: str(e?.hook),
    }))
    .slice(0, 30)
  if (!eps.length) throw new Error('JSON 中缺少 episodes')
  if (!chars.length) chars.push({ name: '主角', role: '主角', tags: ['protagonist'], appearance: '', personality: '', arc: '' })
  return {
    title: str(raw.title, '未命名短剧') || '未命名短剧',
    genre: str(raw.genre),
    artStyle: str(raw.artStyle),
    logline: str(raw.logline),
    world: str(raw.world),
    characters: chars,
    episodes: eps,
  }
}

export async function extractIdeaLlm(llm: LlmSettings, idea: string, signal?: AbortSignal): Promise<IdeaResult> {
  const user = `想法如下：\n${idea}`
  const first = await chatCompletion(llm, IDEA_SYSTEM, user, { signal, temperature: 0.6 })
  try {
    return parseIdeaJson(first)
  } catch {
    // retry once, explicitly demanding strict JSON
    const second = await chatCompletion(
      llm,
      IDEA_SYSTEM,
      `${user}\n\n上一次输出无法解析为 JSON。请只输出一个合法 JSON 对象，不要任何其他文字。`,
      { signal, temperature: 0.3 },
    )
    return parseIdeaJson(second)
  }
}

/** Map free genre text to a preset genre (templates need one) + keep custom label. */
export function mapGenre(g: string, ideaText = ''): { genre: Genre; custom?: string } {
  if ((KNOWN_GENRES as string[]).includes(g)) return { genre: g as Genre }
  const t = `${g} ${ideaText}`
  let genre: Genre = '男频玄幻'
  if (/重生/.test(t) && /(都市|公司|总裁|现代|职场)/.test(t)) genre = '都市重生'
  else if (/(嫡女|宫|宅斗|王爷|侯府|古风|重生)/.test(t)) genre = '古风女频重生'
  else if (/(大女主|女强|女帝|女总裁)/.test(t)) genre = '大女主'
  else if (/(都市|公司|总裁|职场|赘婿|豪门|现代|校园|警|医院|直播)/.test(t)) genre = '都市逆袭'
  else if (/(修仙|玄幻|宗门|灵根|仙|魔|斗气)/.test(t)) genre = '男频玄幻'
  return { genre, custom: g && g !== genre ? g : undefined }
}

export function mapStyle(s: string, genre: Genre): ArtStyle {
  if ((KNOWN_STYLES as string[]).includes(s)) return s as ArtStyle
  if (/真人|写实|实拍/.test(s)) return '真人都市'
  if (/日漫|动漫|二次元/.test(s)) return '2D日漫'
  if (/国风|古风|水墨/.test(s)) return '2D国风'
  return genre === '都市逆袭' || genre === '都市重生' ? '真人都市' : '2D国风'
}

const TAG_ALLOWED = new Set(['protagonist', 'antagonist', 'support', 'mentor', 'romantic', 'deuteragonist'])

export function toCharacters(list: IdeaCharacter[]): Character[] {
  return list.map((c, i) => {
    let tags = c.tags.filter((t) => TAG_ALLOWED.has(t))
    if (!tags.length) {
      if (/主角|男主|女主/.test(c.role)) tags = ['protagonist']
      else if (/反派|对手|敌/.test(c.role)) tags = ['antagonist']
      else if (/师|导师/.test(c.role)) tags = ['mentor']
      else tags = [i === 0 ? 'protagonist' : 'support']
    }
    return {
      id: `c${i + 1}`,
      name: c.name,
      role: c.role || '角色',
      tags,
      visualLock: c.appearance || '待补充外貌与气质',
      costume: '',
      signatureProp: '',
      personality: c.personality,
      arc: c.arc,
    }
  })
}

export function toOutline(eps: IdeaEpisode[]): EpisodeOutline[] {
  return eps.map((e, i) => ({
    episode: i + 1,
    title: e.title,
    hook: e.hook,
    summary: e.summary,
    cliffhanger: i < eps.length - 1 ? e.hook || `下一集：${eps[i + 1].title}` : e.hook || '全剧终',
  }))
}

// ---------- 启发式兜底（无 API Key） ----------
const SURNAMES =
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费薛雷贺倪汤滕殷罗毕郝安常乐于时傅皮卞齐康伍余元顾孟平黄和穆萧尹姚邵湛汪祁毛狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季贾路娄江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫房裘解应宗丁宣邓单杭洪包左石崔龚程邢裴陆荣翁荀甄家封储靳段焦巴牧山谷车侯全班秋仲伊宫宁仇甘厉祖武刘龙叶幸司黎薄印白怀蒲邰从鄂索赖卓蔺屠蒙池乔阴胥苍闻莘党翟谭贡劳姬申扶堵冉宰雍桑桂濮牛寿通边燕冀尚农温庄晏柴瞿阎慕连习艾鱼容向古易慎廖庾终居衡步都耿满弘匡国文寇广禄东欧沃利蔚越夔隆师巩聂晁勾敖融冷辛阚那简饶曾沙养鞠须丰巢关蒯相查后荆红游竺权盖益桓公'

export function heuristicIdea(idea: string): IdeaResult {
  const text = idea.trim()
  const titleMatch = text.match(/《([^》]{1,20})》/)
  const firstSentence = text.split(/[。！？!?\n]/).map((s) => s.trim()).find(Boolean) || '未命名短剧'
  const title = titleMatch ? titleMatch[1] : firstSentence.slice(0, 12)

  // names: 叫/名叫/名为 X, or 姓+1~2字 followed by typical verbs/particles
  const names = new Map<string, number>()
  const add = (n: string) => {
    if (n.length < 2 || n.length > 4) return
    names.set(n, (names.get(n) || 0) + 1)
  }
  for (const m of text.matchAll(/(?:名叫|叫做|叫|名为|名字是)([\u4e00-\u9fa5]{2,3})/g)) add(m[1])
  // surname-led 2/3-char candidates; keep ones that recur (or follow a role noun)
  const body = text.replace(/《[^》]*》/g, '')
  const counts = new Map<string, number>()
  const re = new RegExp(`(?=([${SURNAMES}][\\u4e00-\\u9fa5]{1,2}))`, 'g')
  for (const m of body.matchAll(re)) {
    const c = m[1]
    for (const n of [c.slice(0, 2), c.slice(0, 3)]) if (n.length >= 2) counts.set(n, (counts.get(n) || 0) + 1)
  }
  for (const m of body.matchAll(new RegExp(`(?:员|二代|女友|男友|妻子|丈夫|总裁|少爷|小姐|师父|弟子|同学|老板|女儿|儿子)([${SURNAMES}][\\u4e00-\\u9fa5]{1,2})`, 'g'))) {
    const three = m[1].slice(0, 3)
    add(three.length === 3 && (counts.get(three) || 0) >= 2 ? three : m[1].slice(0, 2))
  }
  for (const [n, c] of counts) {
    if (c < 2 || n.length !== 2) continue
    // prefer 3-char form when it occurs as often as the 2-char prefix
    const longer = [...counts.entries()].find(([k, v]) => k.length === 3 && k.startsWith(n) && v === c)
    add(longer ? longer[0] : n)
  }
  // collapse 3-char names whose 2-char prefix is also a name
  for (const n of [...names.keys()]) {
    if (n.length === 3 && names.has(n.slice(0, 2))) {
      names.set(n.slice(0, 2), (names.get(n.slice(0, 2)) || 0) + (names.get(n) || 0))
      names.delete(n)
    }
  }
  const STOP = /^(一个|这个|那个|但是|于是|可是|然后|时候|自己|什么|因为|所以|为了|最后|开始|成为|发现|余额|时间|万一|方面|白天|明天|常常|和平|安全|高兴)/
  const ranked = [...names.entries()]
    .filter(([n]) => !STOP.test(n))
    .sort((a, b) => b[1] - a[1] || body.indexOf(a[0]) - body.indexOf(b[0]))
    .map(([n]) => n)
    .slice(0, 6)
  if (!ranked.length) ranked.push('主角')

  const characters: IdeaCharacter[] = ranked.map((n, i) => {
    // context = clauses mentioning this name
    const ctx = text.split(/[。！？!?\n，,]/).filter((x) => x.includes(n)).join('')
    let role = i === 0 ? '主角' : '配角'
    let tags = [i === 0 ? 'protagonist' : 'support']
    if (i > 0 && /(反派|陷害|仇|背叛|欺负|对手|敌)/.test(ctx)) {
      role = '对手'
      tags = ['antagonist']
    } else if (i > 0 && /(师父|导师|老师|师傅)/.test(ctx)) {
      role = '导师'
      tags = ['mentor']
    }
    return { name: n, role, tags, appearance: '', personality: '', arc: '' }
  })

  const sentences = text.split(/(?<=[。！？!?\n])/).map((s) => s.trim()).filter(Boolean)
  const epCount = Math.min(8, Math.max(3, Math.ceil(sentences.length / 2)))
  const per = Math.max(1, Math.ceil(sentences.length / epCount))
  const episodes: IdeaEpisode[] = []
  for (let i = 0; i < epCount; i++) {
    const chunk = sentences.slice(i * per, (i + 1) * per).join('')
    episodes.push({
      title: `第${i + 1}集`,
      summary: chunk || (i === epCount - 1 ? '矛盾总爆发，主角完成反转。' : '冲突升级，主角陷入更大困境。'),
      hook: chunk ? chunk.slice(0, 24) : '悬念待补充',
    })
  }
  const { genre } = mapGenre('', text)
  return {
    title,
    genre,
    artStyle: '',
    logline: firstSentence.slice(0, 60),
    world: '',
    characters,
    episodes,
  }
}
