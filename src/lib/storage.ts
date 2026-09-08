import type { LlmSettings, Project } from '../types'
import { DEFAULT_LLM } from '../types'

const PROJECT_KEY = 'ai-short-drama-studio:project'
const LLM_KEY = 'ai-short-drama-studio:llm'

export function loadProject(): Project | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Project
  } catch {
    return null
  }
}

export function saveProject(project: Project): void {
  const next = { ...project, updatedAt: new Date().toISOString() }
  localStorage.setItem(PROJECT_KEY, JSON.stringify(next))
}

function migrateLlmSettings(settings: LlmSettings): LlmSettings {
  const next = { ...DEFAULT_LLM, ...settings }
  // Old studio default pointed at OpenAI; remap to Pixel Workbench LiteLLM.
  if (
    !settings.baseURL ||
    settings.baseURL === 'https://api.openai.com/v1' ||
    settings.baseURL.includes('api.openai.com')
  ) {
    next.baseURL = DEFAULT_LLM.baseURL
  }
  if (!settings.model || settings.model === 'gpt-4o-mini') {
    next.model = DEFAULT_LLM.model
  }
  return next
}

export function loadLlm(): LlmSettings {
  try {
    const raw = localStorage.getItem(LLM_KEY)
    if (!raw) return { ...DEFAULT_LLM }
    return migrateLlmSettings(JSON.parse(raw) as LlmSettings)
  } catch {
    return { ...DEFAULT_LLM }
  }
}

export function saveLlm(settings: LlmSettings): void {
  localStorage.setItem(LLM_KEY, JSON.stringify(settings))
}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
