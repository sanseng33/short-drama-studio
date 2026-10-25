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
 * Cast consistency: look variants sharing a characterKey — a shot casting one variant while the wardrobe timeline
 * there implies another is re-cast (report castCorrections); ambiguous cases only warn (castConsistency).
 * Final prompts: emotion words → visible face / body action, inner monologue + quotes dropped (report emotionRewrites);
 *   a prompt still carrying a quote mark / emotion word / monologue marker fails the run (exit 4).
 *   a mouth / face occluder left inside a spoken line (手拢在嘴边, 捂嘴, 喝水…) fails the run (exit 6).
 * --speech-rate 4 : chars per second of the speech estimate (beat dialogue segment sizing + dialogueOverrun warning)
 * --dialogue-pad 0.3,0.4 : head / tail silence in the dialogue segment. Beat mode lengthens a shot whose dialogue
 *   segment cannot hold speech + pad (0.5 s grid, ≤ 9 s; report durationAdjustments); beyond 9 s only the overrun warning.
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
import { applyCastConsistency } from '../src/lib/castConsistency'
import { applyRenderHold, shotMouthRisks } from '../src/lib/renderHold'
import { META_NOTE, metaRisks, ORPHAN_NOTE, ABSTRACT_PERF_NOTE, TIME_REPEAT_NOTE, CAPTION_NOTE, parseCaptionNote, EMPTY_SCRUB_NOTE, EMPTY_STYLE_NOTE, emptyShotRisks, speechChars, SUBJECT_CARRY_NOTE, SUBJECT_UNRESOLVED_NOTE } from '../src/lib/renderHygiene'
import { TEXT_PROP_NOTE } from '../src/lib/textProps'
import { PERFORMANCE_NOTE } from '../src/lib/beatPrompt'
import { ABSTRACT_PERFORMANCE_RE } from '../src/lib/emotionVisual'
import { parseRewriteNote, promptTextRisks } from '../src/lib/emotionVisual'
import { DEFAULT_DIALOGUE_PAD, dialogueOverruns, DEFAULT_SPEECH_RATE } from '../src/lib/dialogueTiming'
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
const si = args.indexOf('--speech-rate')
const speechRate = si >= 0 ? { charsPerSec: Number(args[si + 1]) } : {}
// --dialogue-pad 0.3,0.4 : silence before / after a line inside its dialogue segment (beat-mode dialogue fit)
const pi = args.indexOf('--dialogue-pad')
const dialoguePad = pi >= 0 ? (([h, tl]) => ({ headSec: h, tailSec: tl ?? h }))(args[pi + 1].split(',').map(Number)) : {}
const pos = args.filter((a, i) => !a.startsWith('--') && (gi < 0 || i !== gi + 1) && (bi < 0 || i !== bi + 1) && (oi < 0 || i !== oi + 1) && (ri < 0 || i !== ri + 1) && (si < 0 || i !== si + 1) && (pi < 0 || i !== pi + 1))
const [inp, outp] = pos
if (!inp) {
  console.error('usage: tsx scripts/repack.ts <in.json> [out.json] [--no-merge] [--genre G] [--beat-mode speed] [--beat-only]')
  process.exit(1)
}
const pack = JSON.parse(readFileSync(inp, 'utf8')) as VideoPipelineExport
// look variants (shared characterKey): re-cast shots whose wardrobe timeline unambiguously implies the other variant
const cast = applyCastConsistency(pack)
const splitCrossCut = flags.has('--split-crosscut') || flags.has('--split-only')
let splits: SplitInfo[] | null = null
let sceneCorrections: SceneCorrection[] | null = null
let rhythmNotes: string[] | null = null
const lite = flags.has('--beat-only') || flags.has('--split-only')
const { exp: exp0, stats } = lite
  ? (() => {
      let e = cast.exp
      if (splitCrossCut) {
        const r = applyCrossCutSplit(e, { sceneOverrides, rhythm })
        e = r.exp
        splits = r.splits
        sceneCorrections = r.corrections
        rhythmNotes = r.rhythmNotes
      }
      return { exp: annotateShots(flags.has('--beat-only') ? applyBeatMode(e, { beatOverrides, speechRate, dialoguePad }) : e, { speechRate }), stats: null }
    })()
  : postProcessExportWithStats(pack, { mergeToSegments: !flags.has('--no-merge'), genre, beatMode, splitCrossCut, sceneOverrides, rhythm, beatOverrides, speechRate, dialoguePad })
// render hold: shots with a blocking issue left after every rule (GPU runner defers them, --defer-flag)
const { exp, renderHold } = applyRenderHold(exp0, { speechRate })
const missing = missingAnnotations(exp)
if (missing.length) {
  console.error(`shots missing framing / wardrobeState: ${missing.join(', ')}`)
  process.exit(2)
}
// final prompts must not carry text the video model could draw: quote marks, emotion words, inner monologue
const textRisks = exp.shots.map((s) => ({ id: s.id, risks: promptTextRisks(s.prompt) })).filter((x) => x.risks.length)
if (textRisks.length) {
  console.error(`prompts with drawable text (${textRisks.length}):\n  ${textRisks.map((x) => `${x.id}: ${x.risks.join('; ')}`).join('\n  ')}`)
  process.exit(4)
}
// an empty shot whose final prompt still asks for a person / acting (exit-4 class: drawable text / faces)
const emptyRisks = exp.shots.filter((s) => s.framing === 'empty').map((s) => ({ id: s.id, risks: emptyShotRisks(s.prompt) })).filter((x) => x.risks.length)
if (emptyRisks.length) {
  console.error(`empty shots with person / acting tokens (${emptyRisks.length}):\n  ${emptyRisks.map((x) => `${x.id}: ${x.risks.join('/')}`).join('\n  ')}`)
  process.exit(4)
}
// nothing may hide the mouth while a line is spoken (lip-sync)
const mouthRisks = exp.shots.map((s) => ({ id: s.id, risks: shotMouthRisks(s) })).filter((x) => x.risks.length)
if (mouthRisks.length) {
  console.error(`prompts occluding the mouth during a line (${mouthRisks.length}):\n  ${mouthRisks.map((x) => `${x.id}: ${x.risks.join('; ')}`).join('\n  ')}`)
  process.exit(6)
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
      // abstract emotion words → visible actions, inner monologue / quotes dropped (final render pass)
      emotionRewrites: exp.shots
        .map((s) => ({ id: s.id, episode: s.episode, rewrites: (s.renderReview || []).map(parseRewriteNote).filter(Boolean) }))
        .filter((x) => x.rewrites.length),
      textRewriteCounts: (() => {
        const c: Record<string, number> = {}
        for (const s of exp.shots) for (const r of (s.renderReview || []).map(parseRewriteNote)) if (r) c[r.kind] = (c[r.kind] || 0) + 1
        c.voiceBeat = exp.shots.reduce((a, s) => a + (s.beatDelivery?.length || 0), 0)
        c.mouthBeat = exp.shots.reduce((a, s) => a + (s.beatTodo || []).filter((x) => x.includes('遮挡嘴部')).length, 0)
        c.mouthFinal = exp.shots.reduce((a, s) => a + (s.renderReview || []).filter((x) => x.includes('遮挡嘴部')).length, 0)
        return c
      })(),
      // mouth / face occluders rewritten (visible equivalent) or dropped inside a spoken line (lip-sync)
      mouthOcclusion: exp.shots.flatMap((s) => [...(s.beatTodo || []), ...(s.renderReview || [])].filter((x) => x.includes('遮挡嘴部')).map((note) => ({ id: s.id, episode: s.episode, note }))),
      // voice / tone text taken out of the picture → the line's TTS delivery hint
      deliveryHints: exp.shots.flatMap((s) => (s.dialogueLines || []).filter((l) => l.delivery).map((l) => ({ id: s.id, episode: s.episode, text: l.text, delivery: l.delivery }))),
      // shots with a blocking issue left after every rule (shot.hold); the GPU runner defers them
      renderHold,
      // round 12 caption / text hygiene (final render pass; counts parsed from renderReview notes)
      ...(() => {
        const notesOf = (pre: string) =>
          exp.shots.map((s) => ({ id: s.id, episode: s.episode, notes: (s.renderReview || []).filter((x) => x.startsWith(pre)).map((x) => x.slice(pre.length)) })).filter((x) => x.notes.length)
        const total = (xs: { notes: string[] }[]) => xs.reduce((a, x) => a + x.notes.reduce((b, n) => b + Number(n.match(/ ×(\d+)$/)?.[1] || 1), 0), 0)
        const props = notesOf(TEXT_PROP_NOTE)
        const scrub = [...notesOf(EMPTY_SCRUB_NOTE), ...notesOf(EMPTY_STYLE_NOTE), ...notesOf('空镜，删去人物描述：')]
        const carry = notesOf(SUBJECT_CARRY_NOTE)
        const unresolved = notesOf(SUBJECT_UNRESOLVED_NOTE)
        const caps = notesOf(CAPTION_NOTE)
        const perShot = exp.shots.map((s) => {
          const after = speechChars(s.prompt)
          const removed = (s.renderReview || []).map(parseCaptionNote).reduce((a, x) => (x ? a + x.times * (speechChars(x.from) - speechChars(x.to)) : a), 0)
          return { id: s.id, episode: s.episode, before: after + removed, after }
        })
        return {
          textProps: { count: total(props), shots: props.length, perShot: props },
          emptyShotScrub: { count: total(scrub), perShot: scrub.reduce<{ id: string; notes: string[] }[]>((a, x) => {
            const g = a.find((y) => y.id === x.id)
            if (g) g.notes.push(...x.notes)
            else a.push({ id: x.id, notes: [...x.notes] })
            return a
          }, []) },
          subjectCarry: { count: total(carry), perShot: carry, unresolved },
          captionWordRewrites: { count: total(caps), perShot: caps },
          // round 13 leftovers
          round13: (() => {
            const perf = exp.shots.map((s) => ({ id: s.id, episode: s.episode, notes: (s.beatTrimmedActions || []).filter((x) => x.startsWith(PERFORMANCE_NOTE)).map((x) => x.slice(PERFORMANCE_NOTE.length)) })).filter((x) => x.notes.length)
            const flat = perf.flatMap((x) => x.notes)
            const backstop = notesOf(ABSTRACT_PERF_NOTE)
            const tl = notesOf(TIME_REPEAT_NOTE)
            const capOf = (re: RegExp) => caps.map((x) => ({ ...x, notes: x.notes.filter((n) => re.test(n)) })).filter((x) => x.notes.length)
            const post = props.map((x) => ({ ...x, notes: x.notes.filter((n) => n.includes('后置限定')) })).filter((x) => x.notes.length)
            const inst = props.map((x) => ({ ...x, notes: x.notes.filter((n) => n.includes('另一件')) })).filter((x) => x.notes.length)
            const pacing = (w: string) => exp.shots.filter((s) => s.prompt.includes(w)).length
            return {
              abstractPerformance: {
                // the beat rule's emotion → visible acting from the emotion table, or skipped (no table word)
                mapped: flat.filter((n) => n.includes(' → ')).length,
                // segments where no emotion of the shot had a table word: nothing written
                dropped: perf.reduce((a, x) => a + [...new Set(x.notes.map((n) => n.split(' ')[0]))].filter((seg) => !x.notes.some((n) => n.startsWith(`${seg} `) && n.includes(' → '))).length, 0),
                skippedPhrases: flat.filter((n) => n.includes('略去')).length,
                perShot: perf,
                finalBackstop: { count: total(backstop), perShot: backstop },
                // gate (promptTextRisks → exit 4): must be 0
                remaining: exp.shots.filter((s) => ABSTRACT_PERFORMANCE_RE.test(s.prompt)).map((s) => s.id),
              },
              postposedQualifiers: { count: total(post), perShot: post },
              separateInstanceQualifiers: { count: total(inst), perShot: inst },
              timeLeadDedupe: { count: total(tl), perShot: tl },
              captionIntent: { 嘀咕: total(capOf(/嘀咕[^→]* →/)), 问话: total(capOf(/问话[^→]* →/)), perShot: capOf(/(?:嘀咕|问话)[^→]* →/) },
              // unchanged by design (they drive H3 beat speed): counts only
              pacingWordPrompts: { 恢复正常节奏: pacing('恢复正常节奏'), 正常节奏: pacing('正常节奏'), 放慢: pacing('放慢'), 利落快速: pacing('利落快速') },
            }
          })(),
          // round 14: orphan acting + director meta-clauses
          round14: (() => {
            const orphan = notesOf(ORPHAN_NOTE)
            const meta = notesOf(META_NOTE)
            const left = exp.shots.map((s) => ({ id: s.id, episode: s.episode, clauses: metaRisks(s.prompt) })).filter((x) => x.clauses.length)
            return {
              orphanActing: {
                count: total(orphan),
                prefixed: orphan.reduce((a, x) => a + x.notes.filter((n) => n.includes('加主语')).length, 0),
                moved: orphan.reduce((a, x) => a + x.notes.filter((n) => n.includes('移到')).length, 0),
                dropped: orphan.reduce((a, x) => a + x.notes.filter((n) => n.endsWith('删去')).length, 0),
                perShot: orphan,
              },
              // before → after per rewritten segment (render-pass text at that point)
              directorMeta: { count: total(meta), perShot: meta },
              // gate (hold): director meta / bare 情绪 left in a timeline segment — must be 0
              metaLeft: { count: left.length, perShot: left },
            }
          })(),
          speechChars: {
            before: perShot.reduce((a, x) => a + x.before, 0),
            after: perShot.reduce((a, x) => a + x.after, 0),
            prompts: perShot.length,
            perShot: perShot.filter((x) => x.before || x.after),
          },
        }
      })(),
      // estimated speech (chars / rate + pauses) longer than the line's slot: warning only
      speechRate: { ...DEFAULT_SPEECH_RATE, ...speechRate },
      dialogueOverrun: dialogueOverruns(exp.shots, speechRate),
      // beat mode lengthened these shots so the dialogue segment holds the estimated speech + pad (≤ 9 s)
      dialoguePad: { ...DEFAULT_DIALOGUE_PAD, ...dialoguePad },
      durationAdjustments: exp.shots
        .filter((s) => s.durationAdjustment)
        .map((s) => ({ shot: s.id, episode: s.episode, old: s.durationAdjustment!.fromSec, new: s.durationAdjustment!.toSec, reason: s.durationAdjustment!.reason, ...(s.splitFrom ? { splitFrom: s.splitFrom } : {}) })),
      durationAdjustmentTotals: eps.map((ep) => {
        const a = exp.shots.filter((s) => s.episode === ep && s.durationAdjustment)
        return { ep, shots: a.length, addedSec: Math.round(a.reduce((t, s) => t + s.durationAdjustment!.toSec - s.durationAdjustment!.fromSec, 0) * 10) / 10 }
      }).filter((x) => x.shots),
      // look-variant cast checks: auto-corrected (timeline unambiguous) / left as is with a cast_consistency warning
      castCorrections: cast.corrections,
      castConsistency: cast.warnings,
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
            crossCutSplits: (splits ? (splits as SplitInfo[]).map((sp) => ({ ...sp, children: sp.children.map((c) => ({ ...c, durationSec: exp.shots.find((x) => x.id === c.id)?.durationSec ?? c.durationSec })) })) : null) ?? (exp.shots.filter((s) => s.splitFrom).reduce<{ id: string; children: string[] }[]>((acc, s) => {
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
