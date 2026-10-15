/** 导出给视频流水线：pure builder for short-drama-studio/video-pipeline@1 */
import type { Project } from '../types'
import { shotCharacterIds, speakerId } from './shotCast'

export const VIDEO_PIPELINE_SCHEMA = 'short-drama-studio/video-pipeline@1'

export interface VideoPipelineShot {
  episode: number
  shotNo: number
  id: string
  characterIds: string[]
  prompt: string
  visual: string
  action: string
  durationSec: number
  dialogue: string
  speaker?: string
  camera: string
  size: string
  emotion: string
  refImage: string | null
}

export interface VideoPipelineExport {
  schema: typeof VIDEO_PIPELINE_SCHEMA
  project: { id: string; title: string; style: string; platform: string; secondsPerEp: number }
  characters: {
    id: string
    name: string
    role: string
    tags: string[]
    visualLock: string
    costume: string
    signatureProp: string
  }[]
  shots: VideoPipelineShot[]
}

export function buildVideoPipelineExport(project: Project): VideoPipelineExport {
  const chars = project.characters
  const eps = Object.keys(project.storyboards || {})
    .map(Number)
    .filter((n) => project.storyboards[n]?.length)
    .sort((a, b) => a - b)
  const shots: VideoPipelineShot[] = []
  for (const ep of eps) {
    const list = [...project.storyboards[ep]].sort((a, b) => a.shotNo - b.shotNo)
    for (const s of list) {
      const prompt = s.seedancePrompt?.trim() || [s.visual, s.action].filter(Boolean).join('，')
      const speaker = s.dialogue ? speakerId(s.dialogue, chars) : undefined
      shots.push({
        episode: ep,
        shotNo: s.shotNo,
        id: s.id,
        characterIds: shotCharacterIds(s, chars),
        prompt,
        visual: s.visual || '',
        action: s.action || '',
        durationSec: s.durationSec,
        dialogue: s.dialogue || '',
        ...(speaker ? { speaker } : {}),
        camera: s.camera,
        size: s.size,
        emotion: s.emotion || '',
        refImage: s.refImage || null,
      })
    }
  }
  return {
    schema: VIDEO_PIPELINE_SCHEMA,
    project: {
      id: project.id,
      title: project.title,
      style: project.style,
      platform: project.platform,
      secondsPerEp: project.secondsPerEp,
    },
    characters: chars.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      tags: c.tags || [],
      visualLock: c.visualLock,
      costume: c.costume,
      signatureProp: c.signatureProp,
    })),
    shots,
  }
}

export function videoPipelineFilename(project: Project): string {
  return `${project.title || 'project'}-video-pipeline.json`
}
