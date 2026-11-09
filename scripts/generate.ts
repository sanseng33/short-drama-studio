/**
 * Headless "idea → one-click generate" with the compliance self-check (same libs as the UI IdeaPanel):
 *   npx tsx scripts/generate.ts --out <script.json> (--idea <idea.txt> | --from-script <script.json>) [--episodes N]
 *     [--model M] [--base URL] [--repairs 2] [--gate-rounds 2] [--seconds 75] [--work DIR]
 * --from-script: the premise is rebuilt from an existing script's project (title / style / setting facts) and its
 *   character cards are kept as the locked cast (visual identity); the story is regenerated from that premise.
 * LLM key from env (never printed): LLM_API_KEY, else OPENROUTER_API_KEY (base openrouter), else DEEPSEEK_API_KEY.
 * Loop: idea → outline + canonical locations → per-episode script → storyboard with validate/repair →
 *   export → repack --beat-only --split-crosscut + scan gates → failing episodes regenerated with the gate feedback.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Character, EpisodeOutline, LlmSettings, Project, Shot } from '../src/types'
import { IDEA_SYSTEM, mapGenre, mapStyle, parseIdeaJson, toCharacters, toOutline, type IdeaResult } from '../src/lib/idea'
import { chatCompletion, SCRIPT_SYSTEM } from '../src/lib/llm'
import { scriptUser } from '../src/lib/prompts'
import { generateStoryboardChecked, parseJsonArray, type Llm } from '../src/lib/generator'
import { buildVideoPipelineExport, type VideoPipelineExport } from '../src/lib/videoExport'
import { withCharacterIdentity } from '../src/lib/voice'
import { assignSceneGroups, breakCarries } from '../src/lib/sceneGroup'
import { applyMultiCast } from '../src/lib/multiCast'
import { assignRealms } from '../src/lib/realm'
import type { StoryboardIssue } from '../src/lib/generatorRules'

const args = process.argv.slice(2)
const arg = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const out = arg('--out')
if (!out || (!arg('--idea') && !arg('--from-script'))) {
  console.error('usage: tsx scripts/generate.ts --out <script.json> (--idea <idea.txt> | --from-script <script.json>) [--episodes N]')
  process.exit(1)
}
const env = process.env
const settings: LlmSettings = env.LLM_API_KEY
  ? { baseURL: env.LLM_BASE_URL || 'https://api.deepseek.com/v1', apiKey: env.LLM_API_KEY, model: env.LLM_MODEL || 'deepseek-chat' }
  : env.OPENROUTER_API_KEY
    ? { baseURL: 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY, model: 'deepseek/deepseek-chat' }
    : { baseURL: 'https://api.deepseek.com/v1', apiKey: env.DEEPSEEK_API_KEY || '', model: 'deepseek-chat' }
if (arg('--model')) settings.model = arg('--model')!
if (arg('--base')) settings.baseURL = arg('--base')!
if (!settings.apiKey) {
  console.error('no LLM key in env (LLM_API_KEY / OPENROUTER_API_KEY / DEEPSEEK_API_KEY) — stopping')
  process.exit(9)
}
const base: Llm = (s, u, t) => chatCompletion(settings, s, u, { temperature: t, signal: AbortSignal.timeout(10 * 60_000) })
const llm: Llm = async (s, u, t) => {
  for (let k = 0; ; k++) {
    try {
      return await base(s, u, t)
    } catch (e) {
      if (k >= 3) throw e
      console.error(`llm retry ${k + 1}: ${(e as Error).message.slice(0, 120)}`)
      await new Promise((r) => setTimeout(r, 3000 * (k + 1)))
    }
  }
}
const repairs = Number(arg('--repairs', '2'))
const gateRounds = Number(arg('--gate-rounds', '2'))
const work = arg('--work', out.replace(/\.json$/, '_work'))!
mkdirSync(work, { recursive: true })
const log = (m: string) => console.error(`[gen ${new Date().toISOString().slice(11, 19)}] ${m}`)

// ---------- premise ----------
let ideaText = ''
let lockedCast: Character[] | null = null
let src: VideoPipelineExport | null = null
if (arg('--from-script')) {
  src = JSON.parse(readFileSync(arg('--from-script')!, 'utf8')) as VideoPipelineExport
  const p = src.project
  lockedCast = src.characters.map((c) => ({ ...(c as unknown as Character), locked: true, refImage: c.refImage || undefined, characterKey: c.characterKey || undefined, voice: c.voice || undefined }))
  ideaText = [
    `剧名：${p.title}`,
    `画风：${p.style}`,
    `设定：\n${(p.settingFacts || []).map((f) => `- ${f}`).join('\n')}`,
    `角色：\n${src.characters.map((c) => `- ${c.name}（${c.role}，${c.age || ''}）：${(c as { background?: string }).background || ''}`).join('\n')}`,
  ].join('\n')
} else ideaText = readFileSync(arg('--idea')!, 'utf8')
const nEp = Number(arg('--episodes', src ? String(new Set(src.shots.map((s) => s.episode)).size) : '0')) || 0
writeFileSync(join(work, 'idea.txt'), ideaText)

const conc = Number(arg('--concurrency', '5'))
/** run fn over items with at most `conc` LLM calls in flight */
async function pool<T>(items: T[], fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

async function json<T>(system: string, user: string, parse: (t: string) => T): Promise<T> {
  let u = user
  for (let k = 0; k < 3; k++) {
    try {
      return parse(await llm(system, u, k ? 0.3 : 0.7))
    } catch (e) {
      u = `${user}\n\n上一次输出无法解析（${(e as Error).message.slice(0, 80)}）。只输出合法 JSON。`
    }
  }
  throw new Error('LLM JSON failed 3 times')
}

const main = async () => {
  if (arg('--resume')) return resume(JSON.parse(readFileSync(arg('--resume')!, 'utf8')) as Project)
  log(`model ${settings.model} via ${new URL(settings.baseURL).host}; episodes ${nEp || 'auto'}`)
  const idea: IdeaResult = await json(IDEA_SYSTEM, `想法如下：\n${ideaText}${nEp ? `\n\n集数固定为 ${nEp} 集（episodes 数组必须正好 ${nEp} 项）。` : ''}${lockedCast ? `\n角色固定为以上 ${lockedCast.length} 个条目（name 原样照抄，不增不减）。` : ''}`, parseIdeaJson)
  if (nEp && idea.episodes.length !== nEp) throw new Error(`idea returned ${idea.episodes.length} episodes, want ${nEp}`)
  writeFileSync(join(work, 'idea.json'), JSON.stringify(idea, null, 2))
  const { genre, custom } = mapGenre(idea.genre, ideaText)
  const style = src ? (src.project.style as Project['style']) : mapStyle(idea.artStyle, genre)
  const fromIdea = toCharacters(idea.characters)
  const gOf = (c: Character) => fromIdea.find((x) => x.name === c.name || (x.baseName && x.baseName === (c.baseName || c.name)))?.gender
  const laOf = (c: Character) => fromIdea.find((x) => x.name === c.name)?.lookalikeOf
  const cast0 = lockedCast ? lockedCast.map((c) => ({ ...c, ...(c.gender || !gOf(c) ? {} : { gender: gOf(c) }), ...(c.lookalikeOf || !laOf(c) ? {} : { lookalikeOf: laOf(c) }) })) : fromIdea
  const pid = src?.project.id || `p_${Date.now()}`
  const characters = withCharacterIdentity(cast0, pid)
  let proj: Project = {
    id: pid,
    title: src?.project.title || idea.title,
    genre,
    customGenre: custom,
    platform: (src?.project.platform as Project['platform']) || '红果',
    episodeCount: idea.episodes.length,
    secondsPerEp: Number(arg('--seconds', String(src?.project.secondsPerEp || 75))),
    style,
    logline: idea.logline,
    worldSetting: idea.world,
    settingFacts: src?.project.settingFacts?.length ? src.project.settingFacts : idea.settingFacts,
    locations: idea.locations?.length ? idea.locations : undefined,
    source: 'idea',
    characters,
    outline: toOutline(idea.episodes) as EpisodeOutline[],
    scripts: {},
    storyboards: {},
    selectedEpisode: 1,
    updatedAt: new Date().toISOString(),
  }
  if (!proj.locations?.length) {
    proj.locations = (await json('你是短剧场景统筹。只输出 JSON 字符串数组。', `根据大纲给出全剧场景表：每个物理场所一个规范名（2-8字），不带人名/梦中/现实/时间；4-12个。\n大纲：${JSON.stringify(proj.outline)}\n设定：${proj.settingFacts.join('；')}`, (t) => parseJsonArray<string>(t))).map(String)
  }
  log(`locations: ${proj.locations!.length}; characters: ${characters.length}`)
  await pool(proj.outline, async (o) => {
    const text = await llm(SCRIPT_SYSTEM, scriptUser(proj, o), 0.8)
    proj.scripts[o.episode] = { episode: o.episode, title: o.title, beats: [{ label: '全文', content: text }], fullText: text }
    log(`script ep${o.episode} ${text.length} chars`)
  })
  writeFileSync(join(work, 'project_scripts.json'), JSON.stringify(proj, null, 2))
  return resume(proj)
}

/** storyboards (when missing) + gate loop from a project with scripts (checkpoint: --resume <project_*.json>) */
async function resume(proj: Project) {
  // identity rule re-applied with the current code (auto refImage placeholders `${characterKey}_v<n>` dropped: video side fills refImage)
  proj.characters = withCharacterIdentity(proj.characters.map((c) => (c.refImage && c.characterKey && new RegExp(`^${c.characterKey}_v\\d+$`).test(c.refImage) ? { ...c, refImage: undefined } : c)), proj.id)
  for (const o of proj.outline.filter((x) => !proj.scripts[x.episode])) {
    const text = await llm(SCRIPT_SYSTEM, scriptUser(proj, o), 0.8)
    proj.scripts[o.episode] = { episode: o.episode, title: o.title, beats: [{ label: '全文', content: text }], fullText: text }
  }
  const issues: Record<number, StoryboardIssue[]> = {}
  const board = async (o: EpisodeOutline, fb?: string[]) => {
    const r = await generateStoryboardChecked(llm, proj, o, proj.scripts[o.episode].fullText, { maxRepairs: repairs, extraFeedback: fb })
    proj.storyboards[o.episode] = r.shots
    issues[o.episode] = r.issues
    log(`storyboard ep${o.episode}: ${r.shots.length} shots, ${r.attempts} attempt(s), ${r.issues.length} open issue(s)${r.issues.length ? `: ${r.issues.map((x) => `${x.shot ?? 'ep'}:${x.rule}`).join(' ')}` : ''}`)
    writeFileSync(join(work, 'project_boards.json'), JSON.stringify(proj, null, 2))
  }
  await pool(proj.outline.filter((o) => !proj.storyboards[o.episode]?.length), (o) => board(o))
  writeFileSync(join(work, 'project_boards.json'), JSON.stringify(proj, null, 2))
  // ---------- gate loop: export → repack + scan → regenerate failing episodes with the feedback ----------
  let gate: Gate = runGates(proj)
  for (let round = 1; round <= gateRounds && Object.keys(gate.byEpisode).length; round++) {
    log(`gate round ${round}: exit ${gate.exit}; failing episodes ${Object.keys(gate.byEpisode).join(',')}`)
    await pool(Object.keys(gate.byEpisode).map(Number), (ep) => board(proj.outline.find((o) => o.episode === ep)!, gate.byEpisode[ep]))
    gate = runGates(proj)
  }
  const exp = withShotContract(buildVideoPipelineExport(proj))
  writeFileSync(out!, JSON.stringify(exp, null, 2) + '\n')
  writeFileSync(join(work, 'project.json'), JSON.stringify(proj, null, 2))
  writeFileSync(join(work, 'generate-report.json'), JSON.stringify({ model: settings.model, episodes: proj.outline.length, locations: proj.locations, openIssues: issues, finalGate: gate }, null, 2))
  log(`wrote ${out}; final gate exit ${gate.exit}; failing episodes: ${Object.keys(gate.byEpisode).join(',') || 'none'}`)
}

/** per-shot contract fields in the generated script: sceneGroup / sceneKeyframe / establishing, cast[] + screenPos,
 *  castCountLock, castDialogue (listenerMouth closed), maxSpeakersPerSegment 1, wardrobeState (from export) */
function withShotContract(e: VideoPipelineExport): VideoPipelineExport {
  return applyMultiCast(breakCarries(assignSceneGroups(assignRealms(e).exp)).exp).exp
}

interface Gate {
  exit: number
  byEpisode: Record<number, string[]>
}
function runGates(proj: Project): Gate {
  const exp = buildVideoPipelineExport(proj)
  const inp = join(work, 'gate_in.json')
  const pk = join(work, 'gate_pack.json')
  writeFileSync(inp, JSON.stringify(exp))
  const by: Record<number, string[]> = {}
  const add = (id: string, msg: string) => {
    const m = id.match(/^s(\d+)-/)
    if (m) (by[Number(m[1])] ||= []).push(`${id}: ${msg}`)
  }
  let exit = 0
  try {
    const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', inp, pk, '--beat-only', '--split-crosscut'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }))
    for (const h of rep.renderHold || []) add(h.shotId, `render hold (${[].concat(h.reasons).join('/')})`)
    for (const g of rep.sceneGroupingAll?.overBudget || []) for (const id of (g.shotIds || []).slice(0, 1)) add(id, `cross-cut budget: ${g.reasons.join('; ')}`)
    // P0-2: A↔B camera-side switch without a master shot (state jumps are auto-fixed by the export and not fed back)
    for (const x of rep.blocking?.axisCross || []) add(x.shotId, `越轴：${x.prevShotId} 机位${x.from} → 本镜机位${x.to}，中间没有 master 镜；加一个 master 镜或改 cameraSide`)
    const scan = JSON.parse(execFileSync('npx', ['tsx', 'scripts/scan-prompts.ts', pk], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }))
    for (const a of scan.anomalies || []) if (a.kind !== 'repeat') add(a.id, `scan ${a.kind}: ${a.detail}`)
  } catch (e) {
    const x = e as { status?: number; stderr?: string }
    exit = x.status ?? 1
    const err = String(x.stderr || '')
    for (const line of err.split('\n')) for (const m of line.matchAll(/\b(s\d+-\d+)[^:]*:\s*(.*)/g)) add(m[1], `exit ${exit}: ${m[2].slice(0, 120)}`)
    const epm = err.match(/episodes over the \d+s cap: (.*)/)
    if (epm) for (const m of epm[1].matchAll(/ep(\d+) ([\d.]+)s/g)) (by[Number(m[1])] ||= []).push(`本集导出后 ${m[2]}s 超过上限：缩短台词/减少镜头`)
  }
  return { exit, byEpisode: by }
}

main().catch((e) => {
  console.error(`generate failed: ${(e as Error).message}`)
  process.exit(1)
})
