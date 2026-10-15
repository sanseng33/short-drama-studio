/** 导出给视频流水线：pure builder for short-drama-studio/video-pipeline@1 */
import type { Project } from '../types'
import { shotCharacterIds, speakerId } from './shotCast'
import { cleanField, cleanPrompt } from './placeholder'

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
  /** present only when a long shot was split into ≤maxShotSec segments */
  segment?: { index: number; total: number; parentId: string }
}

export interface VideoPipelineOptions {
  /** split shots longer than this into near-equal segments (default 10) */
  maxShotSec?: number
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

export function buildVideoPipelineExport(
  project: Project,
  opts: VideoPipelineOptions = {},
): VideoPipelineExport {
  const maxShotSec = Math.max(1, opts.maxShotSec ?? 10)
  const chars = project.characters
  const eps = Object.keys(project.storyboards || {})
    .map(Number)
    .filter((n) => project.storyboards[n]?.length)
    .sort((a, b) => a - b)
  const shots: VideoPipelineShot[] = []
  for (const ep of eps) {
    const list = [...project.storyboards[ep]].sort((a, b) => a.shotNo - b.shotNo)
    for (const s of list) {
      const prompt =
        cleanPrompt(s.seedancePrompt?.trim() || '') ||
        [cleanField(s.visual), cleanField(s.action)].filter(Boolean).join('，')
      const speaker = s.dialogue ? speakerId(s.dialogue, chars) : undefined
      const base: VideoPipelineShot = {
        episode: ep,
        shotNo: s.shotNo,
        id: s.id,
        characterIds: shotCharacterIds(s, chars),
        prompt,
        visual: cleanField(s.visual),
        action: cleanField(s.action),
        durationSec: s.durationSec,
        dialogue: s.dialogue || '',
        ...(speaker ? { speaker } : {}),
        camera: s.camera,
        size: s.size,
        emotion: s.emotion || '',
        refImage: s.refImage || null,
      }
      const d = Number(s.durationSec) || 0
      if (d <= maxShotSec) {
        shots.push(base)
        continue
      }
      const total = Math.ceil(d / maxShotSec)
      // near-equal split in 0.1s units, sums exactly to d
      const units = Math.round(d * 10)
      for (let i = 0; i < total; i++) {
        const u = Math.floor(units / total) + (i < units % total ? 1 : 0)
        const { speaker: _sp, ...rest } = base
        shots.push({
          ...(i === 0 ? base : rest),
          id: `${s.id}-${String.fromCharCode(97 + i)}`,
          characterIds: [...base.characterIds],
          durationSec: u / 10,
          dialogue: i === 0 ? base.dialogue : '',
          segment: { index: i, total, parentId: s.id },
        })
      }
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
      visualLock: cleanField(c.visualLock),
      costume: cleanField(c.costume),
      signatureProp: cleanField(c.signatureProp),
    })),
    shots,
  }
}

export function videoPipelineFilename(project: Project): string {
  return `${project.title || 'project'}-video-pipeline.json`
}
