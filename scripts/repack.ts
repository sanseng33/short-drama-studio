/**
 * npx tsx scripts/repack.ts <in-pack.json> [out.json] [--no-merge] [--genre 都市逆袭] [--beat-mode speed] [--beat-only]
 *   --beat-mode speed : opt-in per-second speed-beat prompts (时间轴（按秒变速）) as the last pass
 *   --beat-only       : only convert prompts to speed beats (no re-merge / re-sanitize of an already final pack)
 *   --split-crosscut  : opt-in split of two-person facing-window / cross-cut segments into solo shots <id>a/<id>b…,
 *                       plus angleKey / carryFromShotId on every shot (runs before beat mode; works with --beat-only)
 *   --split-only      : only the cross-cut split + angle keys on an already final pack (no beat, no re-merge)
 *   --short-ratio 0.3 : rhythm (c) cap of <5 s shots per episode (report + split-child fit); report section rhythmCheck
 *   --allow-missing-voice : diagnostic only — write the pack even when dialogue lines have no voice (voice: null,
 *                       listed in report voiceMissing); without it a line without a resolvable voice fails the run (exit 3)
 *   --scene-overrides f.json : with split: explicit { "shotId": "sceneId" } place corrections (win over the home rule);
 *                              the same file's `beatOverrides` { shotId: [{start,end,speed,text,dialogue?}] } replace the
 *                              automatic beats in beat mode (validated). Report: stretchReview (stretched split children)
 *                              OPT-IN ONLY: without this flag no override file is read (no implicit / default path);
 *                              hand overrides are bug signals for the generic generator, not part of the automatic pipeline.
 * Every output shot gets `framing` + `wardrobeState` (shotAnnotate); the run fails if any shot lacks either.
 * Characters without wardrobeTimeline / wardrobeCues get an AUTO-PROPOSED timeline from script cues
 * (report: wardrobeAutoProposed, reviewRequired) — hand data in the character JSON always wins.
 * Re-apply the deterministic video-pipeline@1 post-processing (style lock, 5–9s merge,
 * time/offlist/logo fixes, sceneId/carryFromPrev) to an already exported pack, and print stats.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { hasNightConflict, postProcessExportWithStats } from '../src/lib/segmentPost'
import type { VideoPipelineExport } from '../src/lib/videoExport'
import { applyBeatMode, type BeatOverrides } from '../src/lib/beatPrompt'
import { checkRhythm, stretchReview } from '../src/lib/rhythm'
import { annotateShots, knownLimitations, MULTI_REF_LIMITATION, missingAnnotations, wardrobeReport } from '../src/lib/shotAnnotate'
import { missingVoices } from '../src/lib/voice'
import { applyCrossCutSplit, reviewCarryChains, validateCarryChain, type SceneCorrection, type SplitInfo } from '../src/lib/crosscutSplit'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const gi = args.indexOf('--genre')
const genre = gi >= 0 ? args[gi + 1] : ''
const bi = args.indexOf('--beat-mode')
const beatMode = bi >= 0 && args[bi + 1] === 'speed' ? 'speed' : flags.has('--beat-only') ? 'speed' : 'off'
const ri = args.indexOf('--short-ratio')
const rhythm = ri >= 0 ? { maxShortRatio: Number(args[ri + 1]) } : {}
const oi = args.indexOf('--scene-overrides')
const overridesFile = oi >= 0 ? JSON.parse(readFileSync(args[oi + 1], 'utf8')) : {}
const sceneOverrides: Record<string, string> | undefined = overridesFile.overrides
// explicit per-shot beats (beat mode only), validated in applyBeatMode
const beatOverrides: BeatOverrides | undefined = overridesFile.beatOverrides
const pos = args.filter((a, i) => !a.startsWith('--') && (gi < 0 || i !== gi + 1) && (bi < 0 || i !== bi + 1) && (oi < 0 || i !== oi + 1) && (ri < 0 || i !== ri + 1))
const [inp, outp] = pos
if (!inp) {
  console.error('usage: tsx scripts/repack.ts <in.json> [out.json] [--no-merge] [--genre G] [--beat-mode speed] [--beat-only]')
  process.exit(1)
}
const pack = JSON.parse(readFileSync(inp, 'utf8')) as VideoPipelineExport
const splitCrossCut = flags.has('--split-crosscut') || flags.has('--split-only')
let splits: SplitInfo[] | null = null
let sceneCorrections: SceneCorrection[] | null = null
let rhythmNotes: string[] | null = null
const lite = flags.has('--beat-only') || flags.has('--split-only')
const { exp, stats } = lite
  ? (() => {
      let e = pack
      if (splitCrossCut) {
        const r = applyCrossCutSplit(e, { sceneOverrides, rhythm })
        e = r.exp
        splits = r.splits
        sceneCorrections = r.corrections
        rhythmNotes = r.rhythmNotes
      }
      return { exp: annotateShots(flags.has('--beat-only') ? applyBeatMode(e, { beatOverrides }) : e), stats: null }
    })()
  : postProcessExportWithStats(pack, { mergeToSegments: !flags.has('--no-merge'), genre, beatMode, splitCrossCut, sceneOverrides, rhythm, beatOverrides })
const missing = missingAnnotations(exp)
if (missing.length) {
  console.error(`shots missing framing / wardrobeState: ${missing.join(', ')}`)
  process.exit(2)
}
// every dialogue line needs a voice: speaker → character voice (characterKey inheritance) or project.voices[speakerName]
const voiceMissing = missingVoices(exp.shots)
if (voiceMissing.length && !flags.has('--allow-missing-voice')) {
  console.error(`dialogue lines without a resolvable voice (${voiceMissing.length}):\n  ${voiceMissing.join('\n  ')}`)
  console.error('set characters[].voice (variants inherit by characterKey) or project.voices { speakerName: voice }; off-list speakers get an auto voice only when they have a speakerName')
  process.exit(3)
}
const out = outp || inp.replace(/\.json$/, '-p2.json')
writeFileSync(out, JSON.stringify(exp, null, 2) + '\n')

const eps = [...new Set(exp.shots.map((s) => s.episode))].sort((a, b) => a - b)
const perEp = eps.map((ep) => {
  const a = pack.shots.filter((s) => s.episode === ep)
  const b = exp.shots.filter((s) => s.episode === ep)
  const sum = (x: { durationSec: number }[]) => Math.round(x.reduce((t, s) => t + s.durationSec, 0) * 10) / 10
  const sceneIds = [...new Set(b.map((s) => s.sceneId).filter(Boolean))]
  const carryTrue = b.filter((s) => s.carryFromPrev).length
  return {
    ep,
    shotsBefore: a.length,
    shotsAfter: b.length,
    secsBefore: sum(a),
    secsAfter: sum(b),
    uniqueSceneIds: sceneIds,
    carryFromPrevTrue: carryTrue,
  }
})
const hist: Record<string, number> = {}
for (const s of exp.shots) hist[s.durationSec] = (hist[s.durationSec] || 0) + 1
const count = (re: RegExp) => exp.shots.filter((s) => re.test(s.prompt)).length
const warn: Record<string, number> = {}
for (const w of exp.warnings) warn[w.code] = (warn[w.code] || 0) + 1
const allSceneIds = [...new Set(exp.shots.map((s) => s.sceneId).filter(Boolean))]
const sample = exp.shots.slice(0, 8).map((s) => ({
  id: s.id,
  sceneId: s.sceneId,
  sceneLabel: s.sceneLabel,
  carryFromPrev: s.carryFromPrev,
  timeOfDay: s.timeOfDay,
}))
console.log(
  JSON.stringify(
    {
      out,
      shotsBefore: pack.shots.length,
      shotsAfter: exp.shots.length,
      perEp,
      allSceneIds,
      carryFromPrevTrue: exp.shots.filter((s) => s.carryFromPrev).length,
      sample,
      durationHistogram: Object.fromEntries(Object.entries(hist).sort((a, b) => +a[0] - +b[0])),
      promptsWithAnime: count(/日漫|2D|赛璐璐/),
      promptsWithLiveActionStyle: count(/真人实拍都市短剧质感/),
      promptsWithNightInDay: exp.shots.filter((s) => /^(清晨|早上|白天)/.test(s.timeOfDay || '') && hasNightConflict(s.prompt)).length,
      promptsWithLogo: exp.shots.filter((s) =>
        /刺绣标|校徽|胸标|logo/i.test(s.prompt.split('服装无任何标志、校徽、刺绣字样').join('')),
      ).length,
      dialogueLines: exp.shots.reduce((a, s) => a + (s.dialogueLines?.length || 0), 0),
      dialogueLinesWithVoice: exp.shots.reduce((a, s) => a + (s.dialogueLines || []).filter((l) => l.voice).length, 0),
      voiceMissing,
      // off-list speakers with an auto-designed voice ({ description, id }): review before TTS
      voiceNeedsReview: Object.values(exp.autoVoices || {}).map((a) => ({ speakerName: a.speakerName, voice: a.voice, basis: a.basis, lines: a.lines, shots: a.shots })),
      dialogueLinesAutoVoice: exp.shots.reduce((a, s) => a + (s.dialogueLines || []).filter((l) => l.autoVoice).length, 0),
      characterVoices: Object.fromEntries(exp.characters.map((c) => [c.id, c.voice ?? null])),
      // FreeVideo first frame = one ref image: every 2+ person medium / full shot (generic, not hand-listed)
      knownLimitations: (() => {
        const k = knownLimitations(exp)
        return { multiPersonFirstFrame: { note: MULTI_REF_LIMITATION, count: k.length, shots: k.map(({ note: _n, ...r }) => r) } }
      })(),
      offscreenLines: exp.shots.filter((s) => s.speakerOffscreen || s.dialogueLines?.some((l) => l.voiceOnly)).length,
      warnings: warn,
      stats,
      overridesFile: oi >= 0 ? args[oi + 1] : null,
      // final render rules: rewritten multi-person subjects, dropped 无人物 / person contradictions (review)
      renderReview: exp.shots.filter((s) => s.renderReview?.length).map((s) => ({ id: s.id, notes: s.renderReview })),
      framing: exp.shots.reduce<Record<string, number>>((a, s) => ((a[s.framing!] = (a[s.framing!] || 0) + 1), a), {}),
      wardrobeState: exp.shots.reduce<Record<string, number>>((a, s) => {
        for (const [id, st] of Object.entries(s.wardrobeState || {})) a[`${id}:${st}`] = (a[`${id}:${st}`] || 0) + 1
        return a
      }, {}),
      // per character: base / timeline source (data | auto-proposed (review) | none), states used, missing refs
      wardrobe: wardrobeReport(exp),
      wardrobeAutoProposed: exp.characters
        .filter((c) => c.wardrobeTimeline?.some((e) => e.autoProposed))
        .map((c) => ({ id: c.id, reviewRequired: true, timeline: c.wardrobeTimeline })),
      ...(beatMode === 'speed'
        ? {
            beatMode,
            beatShots: exp.shots.filter((s) => s.beatMode === 'speed').length,
            beatTodoShots: exp.shots.filter((s) => s.beatTodo?.length).map((s) => ({ id: s.id, todo: s.beatTodo })),
            beatRemovedProps: exp.shots.filter((s) => s.beatRemovedProps?.length).map((s) => ({ id: s.id, removed: s.beatRemovedProps })),
          }
        : {}),
      ...(splitCrossCut
        ? {
            crossCutSplits: (splits ?? exp.shots.filter((s) => s.splitFrom).reduce<{ id: string; children: string[] }[]>((acc, s) => {
              const g = acc.find((x) => x.id === s.splitFrom)
              if (g) g.children.push(s.id)
              else acc.push({ id: s.splitFrom!, children: [s.id] })
              return acc
            }, [])),
            sceneCorrections,
            carryChainErrors: validateCarryChain(exp.shots),
            carryChainReview: reviewCarryChains(exp.shots),
            rhythmFit: rhythmNotes,
            stretchReview: splits ? stretchReview(splits, beatMode === 'speed' ? Object.keys(beatOverrides || {}) : []) : null,
          }
        : {}),
      rhythmCheck: (() => {
        const r = checkRhythm(exp.shots, rhythm)
        return { ok: r.ok, options: r.options, episodeShortRatio: r.episodeShortRatio, consecutiveShort: r.consecutiveShort, brackets: r.brackets, warnings: r.warnings }
      })(),
    },
    null,
    2,
  ),
)
