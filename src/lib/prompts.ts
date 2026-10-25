/** LLM user-prompt builders (pure) — inject setting facts / backgrounds / ages / scene time as hard constraints. */
import type { Character, EpisodeOutline, Project } from '../types'
import { forbiddenStyleText, styleTag, styleToneForGenre } from './templates/styleTag'
import { stripLogoText } from './segmentPost'
import { factsForShotPrompts } from './settingFacts'

/** 平台内容 + 跨集去重规则（随机副作用/惩罚/技能等） */
export const CONTENT_RULES = '【内容规则】每集随机抽到的副作用/惩罚/代价/技能必须各不相同，全剧不得重复；写之前对照前面各集已用过的，不能换个说法再用一次。副作用只能是滑稽、无害、可当天解除的效果（如口音、打嗝、走路自带BGM、说话押韵、见猫就鞠躬），禁止以性取向、性别认同、种族/地域歧视、残障、疾病、宗教、自残或色情暗示作为惩罚或笑点。'
export const FACTS_HEADER = '设定事实，必须遵守，不得与之矛盾'

/** Genre label for prompts. Idea-pipeline projects never get trope labels like 逆袭 (they inject 底层/落魄 tropes). */
export function promptGenre(p: Pick<Project, 'genre' | 'customGenre' | 'source' | 'settingFacts'>): string {
  if (p.customGenre?.trim()) return p.customGenre.trim()
  if (p.source === 'idea' || p.settingFacts?.length) return p.genre.replace(/逆袭|重生/g, '').trim() || '都市'
  return p.genre
}

export function characterBrief(c: Character, full = true) {
  return {
    name: c.name,
    ...(c.baseName ? { baseName: c.baseName } : {}),
    role: c.role,
    tags: c.tags || [],
    ...(c.age ? { age: c.age } : {}),
    ...(c.background ? { background: c.background } : {}),
    ...(full ? { visualLock: c.visualLock, costume: c.costume, signatureProp: c.signatureProp } : {}),
    ...(full && c.personality ? { personality: c.personality } : {}),
  }
}

/** Hard-constraint block: setting facts + per-character background / age. '' when nothing to say. */
export function constraintBlock(p: Pick<Project, 'settingFacts' | 'characters' | 'worldSetting'>): string {
  const lines: string[] = []
  for (const f of p.settingFacts || []) if (f.trim()) lines.push(`- ${f.trim()}`)
  for (const c of p.characters) {
    const bits = [c.age ? `${c.age}岁` : '', c.background || ''].filter(Boolean)
    if (bits.length) lines.push(`- ${c.name}：${bits.join('，')}`)
  }
  if (!lines.length) return CONTENT_RULES
  return `【${FACTS_HEADER}】\n${lines.join('\n')}\n（年龄以上为准，不得另写其他年龄；不要编造设定中没有的年数/时间跨度；场景与服装道具须符合各角色家境。
分镜/剧本须把设定中的空间关系拍进画面：对窗、邻居、别墅/旧楼对比等不能只写在人物小传里；每个主要场景至少 2 个可辨认的家境陈设锚点，禁止空壳「豪华/简陋」形容词充数。）\n${CONTENT_RULES}`
}

const withFacts = (p: Project, body: string) => {
  const b = constraintBlock(p)
  return b ? `${b}\n\n${body}` : body
}

export function outlineUser(p: Project): string {
  return withFacts(
    p,
    `题材:${promptGenre(p)} 标题:${p.title} 集数:${p.episodeCount} 每集${p.secondsPerEp}秒 画风:${p.style} logline:${p.logline}${p.worldSetting ? ` 世界观:${p.worldSetting}` : ''}
角色:${JSON.stringify(p.characters.map((c) => characterBrief(c, false)))}
请生成全部${p.episodeCount}集大纲JSON数组。`,
  )
}

export function scriptUser(p: Project, o: EpisodeOutline): string {
  return withFacts(
    p,
    `写第${o.episode}集剧本。大纲:${JSON.stringify(o)} 角色:${JSON.stringify(p.characters.map((c) => characterBrief(c)))} 时长${p.secondsPerEp}秒 题材${promptGenre(p)}${p.worldSetting ? ` 世界观:${p.worldSetting}` : ''}
每场戏开头标注「场N 地点 · 时间」。`,
  )
}

/** Exact style sentence the storyboard must copy into every 「风格：」 clause. */
export function storyboardStyleLine(p: Pick<Project, 'style' | 'genre'>): string {
  return styleTag(p.style, styleToneForGenre(p.genre))
}
/** Target shot count range for a 5–9s-per-shot episode (≈ secondsPerEp/7). */
export function shotCountRange(secondsPerEp: number): [number, number] {
  const s = Math.max(5, secondsPerEp || 60)
  return [Math.max(1, Math.round(s / 8.5)), Math.max(1, Math.round(s / 5.8))]
}

export function storyboardUser(p: Project, o: EpisodeOutline, scriptText: string): string {
  const tag = storyboardStyleLine(p)
  const ban = forbiddenStyleText(p.style)
  const [lo, hi] = shotCountRange(p.secondsPerEp)
  // shot prompts / video model: world+ongoing only (hide ending spoilers)
  const forShots: Project = { ...p, settingFacts: factsForShotPrompts(p.settingFacts) }
  return withFacts(
    forShots,
    `为第${o.episode}集做分镜。画风${p.style} 时长${p.secondsPerEp}s
【画风句（硬约束，每镜 seedancePrompt 的「风格：」原样照抄）】${tag}${ban ? `\n【画风禁令】${ban}。` : ''}
【镜头数与时长（硬约束）】本集 ${lo}–${hi} 镜（约 ${p.secondsPerEp}÷7），每镜 durationSec 5–9 秒；每镜是一个小节拍：动作+反应，或台词+微表演（说前准备/说后余韵/听者反应写在同一镜时间轴里），不要 2–3 秒碎镜。
大纲:${JSON.stringify(o)}
剧本:${scriptText || '(无)'}
角色(按列表原样使用，勿强行补齐男主女主反派):${JSON.stringify(p.characters.map((c) => characterBrief({ ...c, costume: stripLogoText(c.costume || '') })))}
每镜请在 characters 字段给出画面内出场角色名（造型变体写当前变体全名），画外音角色放 voiceOnly；音效放 sfx，系统界面/文字放 overlayText（人物台词一律放 dialogue）；每镜 timeOfDay 照抄剧本场景时间，提示词光线与之一致，不要默认夜戏；可选 location 短标签（如「别墅卧室」「老楼窗边」「教室」），同一物理场所保持同一标签。
硬约束：
- 每镜一个剧情主动作，时长 5–9 秒；必须另写 1–2 个表演微动作与反应；台词 ≤4.5字/秒且只有一个「名字：」说话人（龙套写身份前缀，且龙套只闻其声不出镜，放 voiceOnly，画面不描绘）。
- 对白必须有反应（可写在同一镜后半段）；禁止连续说话头；运镜禁止连续三镜纯固定。
- 优先单人；对话用过肩/正反打/反应镜头；同框最多2人。
- visual 必须含本场地点的家境陈设锚点，并覆盖设定中的空间关系（如对窗邻居须拍到窗对窗）。
- overlayText 只放界面原文，不放约束或描述；emotion 必须在 action/seedancePrompt 落地为可见表演。
- 服装/道具描写不要写 logo、校徽、胸标、刺绣标、字样。`,
  )
}
