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

export const OUTLINE_SYSTEM = `你是资深AI短剧/漫剧编剧。输出严格 JSON 数组，每项含 episode,title,hook,summary,cliffhanger。中文。压抑-开挂-打脸节奏。不要markdown围栏。`

export const SCRIPT_SYSTEM = `你是短剧编剧。输出中文分集剧本，必须含【3秒钩子】【冲突升级】【反转】【情绪高点】【结尾悬念】，含对白。适合60-90秒竖屏漫剧。`

export const STORYBOARD_SYSTEM = `你是工业分镜师。输出 JSON 数组，字段：shotNo,size,durationSec,visual,action,dialogue,camera,emotion,seedancePrompt,groupNote。
seedancePrompt 必须遵循：主体→动作→镜头→风格→限制；竖屏9:16；重复角色视觉锁定；单主动作；>5秒加时间轴分段。不要markdown围栏。`
