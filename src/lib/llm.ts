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
2. 每镜只有一个主动作：action 禁止出现「随后/然后/接着/紧接着/同时」，连续动作拆成多镜。
3. 台词语速 ≤4.5 字/秒：dialogue 字数（不计标点）≤ durationSec×4.5，放不下就拆镜或删减。
4. 每镜最多一个说话人，dialogue 必须以「名字：」开头，如「林川：……」「林川（冷笑）：……」；画外音写「名字（OS）：……」并放入 voiceOnly；旁白写「旁白：……」；无台词写空字符串 ""（不要写「无」）。不在角色列表里的龙套必须写身份前缀，如「收银员：……」「路人甲：……」，不要省略名字。
5. 音效单独放 sfx 数组（如 ["砰","玻璃碎裂"]），不要写进 dialogue/action。
6. 系统界面/弹窗/转盘/屏幕文字等 UI 内容只放 overlayText 数组（后期叠加），系统说的话也放 overlayText，不要作为台词。
7. 永远不要让视频模型渲染 UI 或文字：visual/seedancePrompt 中不要描述视窗、文字、界面内容（间接光线线索由导出程序按需添加，不要自行在每镜开头写固定套话）。overlayText 只用于界面/系统文字；任何人物说的话（包括「……行。」之类短句）都写进 dialogue，绝不放 overlayText。overlayText 只写要叠加的界面原文（如「本月第47枚」），不要写「限制：不出现文字」之类约束或画面描述。
8. 优先每镜画面内只有一个角色（characters 只1人）；对话戏用过肩、正反打、插入反应镜头代替双人同框，同框最多2人。
9. 每镜 timeOfDay 字段写本场时间（清晨/早上/白天/黄昏/夜），照抄剧本场景标题的时间；seedancePrompt 的光线必须与之一致，没有夜戏就不要写「夜戏/夜景/冷蓝夜色」。
10. 场景、住处、道具必须符合设定事实与角色家境（例如富裕角色的家不能写成老旧居民楼/旧书桌）；年龄只用角色卡给出的 age。
seedancePrompt：主体→动作→镜头→风格→限制；竖屏9:16；只使用用户提供的角色视觉锁定（含服装、标志道具）；单主动作；>5秒加时间轴分段。禁止在角色缺失时硬写女主/男主。不要markdown围栏。`
