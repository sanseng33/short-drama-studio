import type { LlmSettings } from '../types'

/** Accept host or `.../v1` — always end with `/v1`. Empty base is an error. */
function normalizeBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/$/, '')
  if (!base) {
    throw new Error('未配置 Base URL，请在设置中填写（例如 https://api.deepseek.com/v1）。')
  }
  if (!base.endsWith('/v1')) base = `${base}/v1`
  return base
}

export async function chatCompletion(
  settings: LlmSettings,
  system: string,
  user: string,
  opts: { signal?: AbortSignal; temperature?: number } = {},
): Promise<string> {
  if (!settings.apiKey.trim()) {
    throw new Error('未配置 API Key，请改用「模板生成」或在设置中填写密钥。')
  }
  const base = normalizeBaseUrl(settings.baseURL)
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: opts.temperature ?? 0.85,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM 请求失败 (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('LLM 返回为空')
  return text
}

export const OUTLINE_SYSTEM = `你是资深AI短剧/漫剧编剧。输出严格 JSON 数组，每项含 episode,title,hook,summary,cliffhanger。中文。用户给出的「设定事实」与角色身份/家境/年龄是硬约束，必须遵守，不得改写成题材套路（如把富裕角色写成落魄/底层）。不要臆造用户未提供的角色。角色列表有谁就写谁，不要求男主+女主+反派齐全。不要markdown围栏。`

export const SCRIPT_SYSTEM = `你是短剧编剧。输出中文分集剧本。节拍可按故事需要变化（不必固定五段），建议覆盖钩子/冲突/反转/悬念等要素，含对白。适合60-90秒竖屏。严格使用用户提供的角色列表，禁止擅自补齐「女主/男主/反派」。若只有一名角色，就写单人张力戏。
设定事实与角色身份/家境/住处/年龄为硬约束，必须遵守，不得与之矛盾；不要套用「逆袭/底层/落魄」等题材套路改写人物出身；不要自行编造与设定冲突的年龄、年份或时间跨度（如「十年」），没有给出就不写具体数字。
每场戏开头写场景标题：「场N 地点 · 时间（清晨/早上/白天/黄昏/夜）」，时间必须与剧情和设定（如「早上7点」）一致。`

export const STORYBOARD_SYSTEM = `你是工业分镜师。输出 JSON 数组，字段：shotNo,size,durationSec,visual,action,dialogue,camera,emotion,seedancePrompt,groupNote,characters,voiceOnly,sfx,overlayText,timeOfDay。
characters：本镜【画面内出场】角色名数组（必须是用户角色列表中的 name 原文；角色有造型变体如「白朴（变帅前）」「白朴（变帅后）」时必须写当前剧情对应的变体全名；无人物镜头为 []）。
voiceOnly：只闻其声不在画面内的角色名数组（画外音/OS/电话里），没有则 []。
硬性规则（视频模型单段最长10秒，按台词时长剪辑）：
1. 每镜 durationSec 为 2-10 秒整数或 .5，全集时长之和等于本集时长。
2. 每镜只有一个「剧情主动作」（如扔鸡蛋、推窗、扫码）。禁止把两个剧情主动作用「随后/然后/接着/紧接着」串在同一镜；连续剧情动作必须拆镜。
   但是：表演微动作不算违规「同时」——每镜 action 必须包含 1–2 个可见微行为（视线落点、眨眼、吞咽、手指收紧、重心转移、呼吸起伏、嘴角延迟等），可用「一边…一边…」描写微动作依附于主动作。
3. 台词语速 ≤4.5 字/秒：dialogue 字数（不计标点）≤ durationSec×4.5，放不下就拆镜或删减。
4. 每镜最多一个说话人，dialogue 必须以「名字：」开头，如「林川：……」「林川（冷笑）：……」；画外音写「名字（OS）：……」并放入 voiceOnly；旁白写「旁白：……」；无台词写空字符串 ""（不要写「无」）。不在角色列表里的龙套必须写身份前缀，如「收银员：……」「路人甲：……」，不要省略名字。
5. 音效单独放 sfx 数组（如 ["砰","玻璃碎裂"]），不要写进 dialogue/action。
6. 系统界面/弹窗/转盘/屏幕文字等 UI 内容只放 overlayText 数组（后期叠加），系统说的话也放 overlayText，不要作为台词。
7. 永远不要让视频模型渲染 UI 或文字：visual/seedancePrompt 中不要描述视窗、文字、界面内容（间接光线线索由导出程序按需添加，不要自行在每镜开头写固定套话）。overlayText 只用于界面/系统文字；任何人物说的话（包括「……行。」之类短句）都写进 dialogue，绝不放 overlayText。overlayText 只写要叠加的界面原文（如「本月第47枚」），不要写「限制：不出现文字」之类约束或画面描述。
8. 优先单人镜头；对话用过肩/正反打，同框最多2人。
   对白硬性节拍：每一轮「A说→B说」之间，必须插入至少 1 镜无台词反应镜（听者微表情/握道具/环境声画），不得说话头连打。
   节奏：全集禁止超过一半镜头 durationSec 取同一个数；至少 30% 镜头为 2–3.5 秒短反应，允许 7–10 秒情绪延展。
   运镜：禁止连续 ≥3 镜 camera 只写「固定机位」；须在推/拉/微手持/侧打/过肩/轻微跟移中轮换。
9. 每镜 timeOfDay 字段写本场时间（清晨/早上/白天/黄昏/夜），照抄剧本场景标题的时间；seedancePrompt 的光线必须与之一致，没有夜戏就不要写「夜戏/夜景/冷蓝夜色」。
10. 场景必须「举证」设定事实，而非仅不矛盾：
   - 从用户【设定事实】抽出空间关系（对窗、邻居、别墅、旧楼、教室等），本场至少 1 镜 visual 写明该关系（例：白朴别墅二楼窗与对面旧楼吴耐窗形成对视轴线）。
   - 富裕居所 ≥2 个陈设锚点（落地窗纱/品牌灯具/整洁衣帽间/哑光地板等）；贫困居所 ≥2 个（旧窗框/磨损窗台/对面晾衣/墙皮斑驳等）。
   - 禁止空壳地点词单独成景： ban「宽敞明亮的卧室」「整齐的教室」「豪华别墅」而不写陈设。
   - 年龄只用角色卡 age；服装道具符合家境。
11. 表演落地：emotion 字段的标签必须翻译进 action 与 seedancePrompt（建议增加「表演：」子句）。禁止 action 仅写「…说话/喊话/回答/自语」。台词镜至少包含：开口前准备半拍、视线落点、说完余韵 三者之一。禁止把「僵住/凝固/愣住/面无表情」当作唯一表演，须改成具体微动态（指尖抽动、喉结滚动、眼神闪避后再强装对视等）。
12. 潜台词：若 dialogue 带「（冷笑/小声/心虚）」等，action 须写出与字面不一致的身体信号（口是心非）。
seedancePrompt：主体→动作（含微表演）→表演→镜头→环境陈设与光线→风格→限制；竖屏9:16；只用用户角色视觉锁定；剧情主动作唯一且可带微动作；>5秒加时间轴（前段微反应/后段主动作或对调）。禁止角色缺失时硬写女主/男主。不要markdown围栏。`
