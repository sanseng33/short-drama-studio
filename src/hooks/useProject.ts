import { useCallback, useEffect, useState } from 'react'
import type { LlmSettings, Project, StepId } from '../types'
import { DEFAULT_LLM } from '../types'
import {
  createBlankProject,
  createSampleProject,
  defaultCharacters,
  defaultLogline,
  defaultStyleForGenre,
  defaultTitle,
  generateOutline,
  generateScript,
  generateStoryboard,
} from '../lib/templates'
import { loadLlm, loadProject, saveLlm, saveProject } from '../lib/storage'
import { normalizeLlmShots } from '../lib/shotCast'
import { mergeLockedCharacters } from '../lib/idea'
import { outlineUser, scriptUser, storyboardUser } from '../lib/prompts'
import { chatCompletion, OUTLINE_SYSTEM, SCRIPT_SYSTEM, STORYBOARD_SYSTEM } from '../lib/llm'
import type { EpisodeOutline, Shot } from '../types'

export function useProject() {
  const [project, setProject] = useState<Project>(() => loadProject() || createSampleProject())
  const [llm, setLlm] = useState<LlmSettings>(() => loadLlm())
  const [step, setStep] = useState<StepId>('idea')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    saveProject(project)
  }, [project])

  useEffect(() => {
    saveLlm(llm)
  }, [llm])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2200)
  }, [])

  const requireCast = useCallback(
    (chars: Project['characters']) => {
      if (!chars.length) {
        flash('请至少保留 1 个角色再生成')
        return false
      }
      return true
    },
    [flash],
  )

  const update = useCallback((patch: Partial<Project>) => {
    setProject((p) => ({ ...p, ...patch }))
  }, [])

  const newProject = useCallback(() => {
    setProject(createBlankProject())
    setStep('project')
    flash('已新建空白项目')
  }, [flash])

  const loadSample = useCallback(() => {
    setProject(createSampleProject())
    setStep('project')
    flash('已加载示例项目（都市逆袭·真人都市）')
  }, [flash])

  const applyGenreDefaults = useCallback(() => {
    setProject((p) => {
      const title =
        p.title === '未命名漫剧' || p.title === '未命名短剧' || !p.title
          ? defaultTitle(p.genre)
          : p.title
      return {
        ...p,
        title,
        style: defaultStyleForGenre(p.genre),
        // Genre default cast is a named preset seed — user can add/remove freely afterward
        characters: mergeLockedCharacters(p.characters, defaultCharacters(p.genre)),
        logline: p.logline.trim() ? p.logline : defaultLogline(p.genre, title),
      }
    })
    flash('已应用题材预设（画风 / logline / 推荐阵容，可再改）')
  }, [flash])

  const genOutlineTemplate = useCallback(() => {
    setProject((p) => {
      if (!p.characters.length) {
        flash('请至少保留 1 个角色再生成')
        return p
      }
      return {
        ...p,
        outline: generateOutline(p.genre, p.episodeCount, p.title),
      }
    })
    flash('大纲已用模板生成')
  }, [flash])

  const genOutlineLlm = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const p = project
      const user = outlineUser(p)
      const text = await chatCompletion(llm, OUTLINE_SYSTEM, user)
      const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim()) as EpisodeOutline[]
      setProject((prev) => ({ ...prev, outline: json }))
      flash('大纲已用 LLM 生成')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [flash, llm, project])

  const genScriptTemplate = useCallback(() => {
    setProject((p) => {
      if (!p.characters.length) {
        flash('请至少保留 1 个角色再生成')
        return p
      }
      const ep = p.selectedEpisode
      const outline = p.outline.find((o) => o.episode === ep)
      if (!outline) {
        flash('请先生成大纲')
        return p
      }
      const script = generateScript(p.genre, ep, outline, p.characters, p.secondsPerEp)
      return { ...p, scripts: { ...p.scripts, [ep]: script } }
    })
    flash(`第${project.selectedEpisode}集剧本已模板生成`)
  }, [flash, project.selectedEpisode])

  const genScriptLlm = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const p = project
      const outline = p.outline.find((o) => o.episode === p.selectedEpisode)
      if (!outline) throw new Error('请先生成大纲')
      const user = scriptUser(p, outline)
      const text = await chatCompletion(llm, SCRIPT_SYSTEM, user)
      setProject((prev) => ({
        ...prev,
        scripts: {
          ...prev.scripts,
          [p.selectedEpisode]: {
            episode: p.selectedEpisode,
            title: outline.title,
            beats: [{ label: '全文', content: text }],
            fullText: text,
          },
        },
      }))
      flash('剧本已用 LLM 生成')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [flash, llm, project])

  const genStoryboardTemplate = useCallback(() => {
    setProject((p) => {
      const ep = p.selectedEpisode
      const outline = p.outline.find((o) => o.episode === ep)
      let script = p.scripts[ep]
      if (!outline) {
        flash('请先生成大纲')
        return p
      }
      if (!script) {
        script = generateScript(p.genre, ep, outline, p.characters, p.secondsPerEp)
      }
      const shots = generateStoryboard(
        p.genre,
        ep,
        outline,
        script,
        p.characters,
        p.style,
        p.secondsPerEp,
      )
      return {
        ...p,
        scripts: { ...p.scripts, [ep]: script },
        storyboards: { ...p.storyboards, [ep]: shots },
      }
    })
    flash(`第${project.selectedEpisode}集分镜已模板生成`)
  }, [flash, project.selectedEpisode])

  const genStoryboardLlm = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const p = project
      const outline = p.outline.find((o) => o.episode === p.selectedEpisode)
      const script = p.scripts[p.selectedEpisode]
      if (!outline) throw new Error('请先生成大纲')
      const user = storyboardUser(p, outline, script?.fullText || '')
      const text = await chatCompletion(llm, STORYBOARD_SYSTEM, user)
      const raw = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim()) as Shot[]
      const shots = normalizeLlmShots(raw, p.selectedEpisode, p.characters)
      setProject((prev) => ({
        ...prev,
        storyboards: { ...prev.storyboards, [p.selectedEpisode]: shots },
      }))
      flash('分镜已用 LLM 生成')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [flash, llm, project])

  return {
    project,
    setProject,
    update,
    llm,
    setLlm,
    step,
    setStep,
    busy,
    toast,
    error,
    setError,
    flash,
    newProject,
    loadSample,
    applyGenreDefaults,
    genOutlineTemplate,
    genOutlineLlm,
    genScriptTemplate,
    genScriptLlm,
    genStoryboardTemplate,
    genStoryboardLlm,
  }
}

export type ProjectApi = ReturnType<typeof useProject>
