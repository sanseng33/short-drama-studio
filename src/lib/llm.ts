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
): Promise<string> {
  if (!settings.apiKey.trim()) {
    throw new Error('未配置 API Key，请改用「模板生成」或在设置中填写密钥。')
  }
  const base = normalizeBaseUrl(settings.baseURL)
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.85,
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

export const OUTLINE_SYSTEM = `你是资深AI短剧/漫剧编剧。输出严格 JSON 数组，每项含 episode,title,hook,summary,cliffhanger。中文。可参考压抑-开挂-打脸，但不要臆造用户未提供的角色。角色列表有谁就写谁，不要求男主+女主+反派齐全。不要markdown围栏。`

export const SCRIPT_SYSTEM = `你是短剧编剧。输出中文分集剧本。节拍可按故事需要变化（不必固定五段），建议覆盖钩子/冲突/反转/悬念等要素，含对白。适合60-90秒竖屏。严格使用用户提供的角色列表，禁止擅自补齐「女主/男主/反派」。若只有一名角色，就写单人张力戏。`

export const STORYBOARD_SYSTEM = `你是工业分镜师。输出 JSON 数组，字段：shotNo,size,durationSec,visual,action,dialogue,camera,emotion,seedancePrompt,groupNote。
镜数可随剧情与角色数量变化。seedancePrompt：主体→动作→镜头→风格→限制；竖屏9:16；只使用用户提供的角色视觉锁定；单主动作；>5秒加时间轴分段。禁止在角色缺失时硬写女主/男主。不要markdown围栏。`
