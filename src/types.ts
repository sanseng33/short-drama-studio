export type Genre =
  | '男频玄幻'
  | '都市逆袭'
  | '都市重生'
  | '古风女频重生'
  | '大女主'

export type Platform = '红果' | '抖音试水' | '海外ReelShort'

export type ArtStyle = '2D国风' | '2D日漫' | '真人都市'

export type StepId =
  | 'project'
  | 'characters'
  | 'outline'
  | 'script'
  | 'storyboard'
  | 'export'
  | 'settings'

export interface Character {
  id: string
  name: string
  role: string
  visualLock: string
  costume: string
  signatureProp: string
}

export interface EpisodeOutline {
  episode: number
  title: string
  hook: string
  summary: string
  cliffhanger: string
}

export interface ScriptBeat {
  label: string
  content: string
  dialogue?: string
}

export interface EpisodeScript {
  episode: number
  title: string
  beats: ScriptBeat[]
  fullText: string
}

export type ShotSize =
  | '大远景'
  | '远景'
  | '全景'
  | '中景'
  | '近景'
  | '特写'
  | '大特写'

export type CameraMove =
  | '固定'
  | '推'
  | '拉'
  | '摇'
  | '移'
  | '跟'
  | '升'
  | '降'
  | '环绕'

export interface Shot {
  id: string
  shotNo: number
  size: ShotSize
  durationSec: number
  visual: string
  action: string
  dialogue: string
  camera: CameraMove
  emotion: string
  seedancePrompt: string
  groupNote?: string
  refImage?: string
}

export interface Project {
  id: string
  title: string
  genre: Genre
  platform: Platform
  episodeCount: number
  secondsPerEp: number
  style: ArtStyle
  logline: string
  characters: Character[]
  outline: EpisodeOutline[]
  scripts: Record<number, EpisodeScript>
  storyboards: Record<number, Shot[]>
  selectedEpisode: number
  updatedAt: string
}

export interface LlmSettings {
  baseURL: string
  apiKey: string
  model: string
}

export const DEFAULT_LLM: LlmSettings = {
  // OpenAI-compatible DeepSeek. Fill API Key in Settings (localStorage only).
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-v4-flash',
}

export const STEPS: { id: StepId; label: string; desc: string }[] = [
  { id: 'project', label: '项目设定', desc: '题材 / 平台 / 集数' },
  { id: 'characters', label: '角色卡', desc: '视觉锁定与人设' },
  { id: 'outline', label: '大纲', desc: '分集钩子与悬念' },
  { id: 'script', label: '分集剧本', desc: '三秒钩子·反转·悬念' },
  { id: 'storyboard', label: '分镜表', desc: '工业分镜 + Seedance' },
  { id: 'export', label: '导出', desc: 'MD / JSON / 提示词包' },
  { id: 'settings', label: '设置', desc: '可选 LLM API' },
]
