import { useRef, useState } from 'react'
import type { ProjectApi } from '../hooks/useProject'
import type { EpisodeScript, Project, Shot } from '../types'
import {
  IDEA_MAX_CHARS,
  countChars,
  extractIdeaLlm,
  heuristicIdea,
  mapGenre,
  mapStyle,
  toCharacters,
  toOutline,
  mergeLockedCharacters,
  mergeLockedFacts,
  type IdeaResult,
} from '../lib/idea'
import { generateStoryboardChecked, llmOf } from '../lib/generator'
import { isScriptLocked, projectFactsFromItems } from '../lib/consistency/factLocks'
import { applyOneClickScript, applyOneClickStoryboard, collectLockedKeeps } from '../lib/consistency/scriptLockGuards'
import { withCharacterIdentity } from '../lib/voice'
import { chatCompletion, SCRIPT_SYSTEM, STORYBOARD_SYSTEM } from '../lib/llm'
import { scriptUser, storyboardUser } from '../lib/prompts'
import { generateScript, generateStoryboard } from '../lib/templates'

type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped'
interface PipeStep {
  key: string
  label: string
  state: StepState
  note?: string
}

type Scope = 'all' | 'first3' | 'none'

const IDEA_DRAFT_KEY = 'sds_idea_draft'

function stripFence(t: string): string {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : t).trim()
}

export function IdeaPanel({ api }: { api: ProjectApi }) {
  const { llm, setProject, setStep, flash, project: prevProject } = api
  const [idea, setIdea] = useState(() => localStorage.getItem(IDEA_DRAFT_KEY) || '')
  const [scope, setScope] = useState<Scope>('all')
  const [steps, setSteps] = useState<PipeStep[]>([])
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState('')
  const [factsHint, setFactsHint] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const len = countChars(idea)
  const over = len > IDEA_MAX_CHARS
  const hasKey = !!llm.apiKey.trim()

  const onChange = (v: string) => {
    // hard limit: truncate pasted text beyond the cap
    const arr = Array.from(v)
    const next = arr.length > IDEA_MAX_CHARS ? arr.slice(0, IDEA_MAX_CHARS).join('') : v
    if (arr.length > IDEA_MAX_CHARS) flash(`已截断至 ${IDEA_MAX_CHARS} 字`)
    setIdea(next)
    localStorage.setItem(IDEA_DRAFT_KEY, next)
  }

  const patchStep = (key: string, patch: Partial<PipeStep>) =>
    setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  const cancel = () => {
    abortRef.current?.abort()
  }

  const run = async () => {
    if (!idea.trim() || over || running) return
    const ac = new AbortController()
    abortRef.current = ac
    const useLlm = hasKey
    setRunning(true)
    setSummary('')
    const plan: PipeStep[] = [
      { key: 'extract', label: useLlm ? '① LLM 解析想法（结构化 JSON）' : '① 启发式解析想法（无 Key）', state: 'pending' },
      { key: 'fill', label: '② 写入项目：设定 / 角色 / 大纲', state: 'pending' },
      { key: 'script', label: '③ 逐集生成剧本', state: 'pending' },
      { key: 'board', label: '④ 逐集生成分镜 + Seedance 提示词', state: 'pending' },
    ]
    setSteps(plan)
    const checkAbort = () => {
      if (ac.signal.aborted) throw new DOMException('cancelled', 'AbortError')
    }
    let current = 'extract'
    let warnings = 0
    try {
      // (1) extract
      patchStep('extract', { state: 'running' })
      let result: IdeaResult
      if (useLlm) {
        result = await extractIdeaLlm(llm, idea, ac.signal)
      } else {
        result = heuristicIdea(idea)
      }
      checkAbort()
      patchStep('extract', {
        state: 'done',
        note: `《${result.title}》· ${result.characters.length} 个角色 · ${result.episodes.length} 集`,
      })

      // (2) fill project
      current = 'fill'
      patchStep('fill', { state: 'running' })
      const { genre, custom } = mapGenre(result.genre, idea)
      const style = mapStyle(result.artStyle, genre)
      // keep 定妆图 / locked looks from the current project (visualLock/costume authoritative)
      // identity rule: characterKey / refImage prefix / gender / auto voice (gender + age) for every character
      const characters = withCharacterIdentity(mergeLockedCharacters(prevProject.characters, toCharacters(result.characters)), result.title)
      const outline = toOutline(result.episodes)
      const factItems = mergeLockedFacts(prevProject.settingFactItems, result.settingFacts)
      const { scripts: keptScripts, storyboards: keptBoards, episodes: keptEpisodes } = collectLockedKeeps(prevProject)
      let proj: Project = {
        id: `p_${Date.now()}`,
        title: result.title,
        genre,
        customGenre: custom,
        platform: '红果',
        episodeCount: outline.length,
        secondsPerEp: 75,
        style,
        logline: result.logline,
        worldSetting: result.world,
        settingFactItems: factItems,
        settingFacts: projectFactsFromItems(factItems),
        ...(result.locations?.length ? { locations: result.locations } : {}),
        source: 'idea',
        characters,
        outline,
        scripts: keptScripts,
        storyboards: keptBoards,
        selectedEpisode: 1,
        updatedAt: new Date().toISOString(),
        locks: prevProject.locks,
      }
      setProject(proj)
      patchStep('fill', { state: 'done', note: `题材 ${genre}${custom ? `（自定义：${custom}）` : ''} · 画风 ${style}` })

      const targets =
        scope === 'none' ? [] : scope === 'first3' ? outline.slice(0, 3) : outline
      if (!targets.length) {
        patchStep('script', { state: 'skipped', note: '已选择不自动生成' })
        patchStep('board', { state: 'skipped', note: '已选择不自动生成' })
      } else {
        // (3) scripts
        current = 'script'
        patchStep('script', { state: 'running', note: `0 / ${targets.length}` })
        for (let i = 0; i < targets.length; i++) {
          checkAbort()
          const o = targets[i]
          let script: EpisodeScript | null = null
          if (useLlm && !(isScriptLocked(prevProject, o.episode) && proj.scripts[o.episode])) {
            try {
              const user = scriptUser(proj, o)
              const text = await chatCompletion(llm, SCRIPT_SYSTEM, user, { signal: ac.signal })
              script = { episode: o.episode, title: o.title, beats: [{ label: '全文', content: text }], fullText: text }
            } catch (e) {
              if (ac.signal.aborted) throw e
              warnings++
            }
          }
          const llmScript = script
          const scriptStep = applyOneClickScript(
            prevProject,
            proj,
            o.episode,
            () => llmScript || generateScript(genre, o.episode, o, proj.characters, proj.secondsPerEp),
          )
          proj = scriptStep.project
          if (scriptStep.kept) {
            patchStep('script', { note: `${i + 1} / ${targets.length}（保留锁定剧本）` })
            continue
          }
          const snap = proj
          setProject((p) => ({ ...p, scripts: { ...p.scripts, [o.episode]: snap.scripts[o.episode] } }))
          patchStep('script', { note: `${i + 1} / ${targets.length}` })
        }
        patchStep('script', { state: 'done' })

        // (4) storyboards
        current = 'board'
        patchStep('board', { state: 'running', note: `0 / ${targets.length}` })
        for (let i = 0; i < targets.length; i++) {
          checkAbort()
          const o = targets[i]
          const script = proj.scripts[o.episode]
          let shots: Shot[] | null = null
          if (useLlm && !(isScriptLocked(prevProject, o.episode) && proj.storyboards[o.episode]?.length)) {
            try {
              // self-check / repair loop (generatorRules): re-prompts until the storyboard passes or retries run out
              const r = await generateStoryboardChecked(llmOf(llm, ac.signal), proj, o, script?.fullText || '')
              shots = r.shots
              if (r.issues.length) warnings++
            } catch (e) {
              if (ac.signal.aborted) throw e
              warnings++
            }
          }
          const llmShots = shots
          const boardStep = applyOneClickStoryboard(
            prevProject,
            proj,
            o.episode,
            () => llmShots || generateStoryboard(genre, o.episode, o, script, proj.characters, style, proj.secondsPerEp),
          )
          proj = boardStep.project
          const audited = proj
          setProject((p) => ({
            ...p,
            storyboards: { ...p.storyboards, [o.episode]: audited.storyboards[o.episode] },
            dialogueAudit: { ...p.dialogueAudit, ...audited.dialogueAudit },
            fingerprints: audited.fingerprints,
          }))
          patchStep('board', {
            note: `${i + 1} / ${targets.length}${boardStep.kept ? '（保留已有分镜）' : ''}`,
          })
        }
        patchStep('board', { state: 'done' })
      }
      const keptNote = keptEpisodes.length
        ? `已保留锁定剧本：第 ${keptEpisodes.join('、')} 集。`
        : ''
      setSummary(
        `完成！《${proj.title}》已生成。${warnings ? `其中 ${warnings} 次 LLM 调用失败，已用模板兜底。` : ''}${keptNote}各步骤结果均可在左侧「角色卡 / 大纲 / 分集剧本 / 分镜表」继续编辑。`,
      )
      setFactsHint(true)
      flash('一键生成完成')
    } catch (e) {
      const aborted = ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')
      setSteps((s) =>
        s.map((x) =>
          x.key === current
            ? { ...x, state: 'error', note: aborted ? '已取消' : e instanceof Error ? e.message : String(e) }
            : x.state === 'pending'
              ? { ...x, state: 'skipped' }
              : x,
        ),
      )
      setSummary(aborted ? '已取消。已完成的部分已保留在项目中，可继续编辑。' : '生成中断，已完成部分已保留。')
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const icon = (s: StepState) =>
    s === 'done' ? '✓' : s === 'running' ? '…' : s === 'error' ? '✕' : s === 'skipped' ? '–' : '○'

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">从想法一键生成</h2>
        {factsHint ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-950/20 p-2 text-sm text-amber-200">
            <span>请过目设定事实</span>
            <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setFactsHint(false)}>
              忽略
            </button>
          </div>
        ) : null}
        <p className="mt-1 text-sm text-ink-muted">
          粘贴任意格式的剧本想法（人物、设定、桥段都行），一键得到：标题/题材/画风/logline/世界观 → 角色卡 → 分集大纲 →
          逐集剧本 → 分镜表与 Seedance 提示词。生成后每一步都可在左侧继续手改；手动流程不受影响。
        </p>
      </header>

      {!hasKey && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          未配置 API Key：将使用<strong>启发式简单抽取</strong>（关键词/人名识别）+ 模板生成，结果较粗糙。
          在「设置」填入 LLM Key（默认 DeepSeek）后效果会好得多。
          <button type="button" className="ml-2 underline" onClick={() => setStep('settings')}>
            去设置
          </button>
        </div>
      )}

      <div>
        <div className="flex items-end justify-between">
          <label className="label">剧本想法（最多 {IDEA_MAX_CHARS} 字）</label>
          <span className={`text-xs ${over ? 'text-red-300' : len > IDEA_MAX_CHARS * 0.9 ? 'text-amber-300' : 'text-ink-faint'}`}>
            {len} / {IDEA_MAX_CHARS}
          </span>
        </div>
        <textarea
          className="field min-h-[260px]"
          value={idea}
          disabled={running}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例：外卖员林凡被富二代当众羞辱，意外获得能看见别人账户余额的眼镜。前女友苏晴嫁入豪门后发现丈夫在洗钱……想拍 6 集，真人都市风。"
        />
        {over && <p className="mt-1 text-xs text-red-300">超出字数上限，请删减后再生成。</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-ink-muted">自动生成剧本/分镜：</label>
        <select className="field !w-auto" value={scope} disabled={running} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="all">全部集</option>
          <option value="first3">仅前 3 集（更快）</option>
          <option value="none">不生成，只出设定/角色/大纲</option>
        </select>
        {!running ? (
          <button type="button" className="btn-primary" disabled={!idea.trim() || over} onClick={run}>
            一键生成
          </button>
        ) : (
          <button type="button" className="btn-outline text-red-300" onClick={cancel}>
            取消
          </button>
        )}
      </div>
      <p className="text-xs text-ink-faint">注意：一键生成会替换当前项目（建议先在「导出」保存 JSON）。</p>

      {steps.length > 0 && (
        <ol className="space-y-2 rounded-lg border border-surface-700 bg-surface-900/60 p-4">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3 text-sm">
              <span
                className={`w-4 font-mono ${
                  s.state === 'done' ? 'text-emerald-300' : s.state === 'error' ? 'text-red-300' : s.state === 'running' ? 'text-accent-soft' : 'text-ink-faint'
                }`}
              >
                {icon(s.state)}
              </span>
              <span className={s.state === 'pending' || s.state === 'skipped' ? 'text-ink-faint' : ''}>{s.label}</span>
              {s.note && <span className="ml-auto text-xs text-ink-muted">{s.note}</span>}
            </li>
          ))}
        </ol>
      )}

      {summary && (
        <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-200">
          <p>{summary}</p>
          <div className="flex flex-wrap gap-2">
            {(['project', 'characters', 'outline', 'script', 'storyboard'] as const).map((id, i) => (
              <button key={id} type="button" className="btn-ghost !py-1 text-xs" onClick={() => setStep(id)}>
                {['查看设定', '编辑角色', '编辑大纲', '编辑剧本', '编辑分镜'][i]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
