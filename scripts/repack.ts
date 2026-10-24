/**
 * npx tsx scripts/repack.ts <in-pack.json> [out.json] [--no-merge] [--genre 都市逆袭] [--beat-mode speed] [--beat-only]
 *   --beat-mode speed : opt-in per-second speed-beat prompts (时间轴（按秒变速）) as the last pass
 *   --beat-only       : only convert prompts to speed beats (no re-merge / re-sanitize of an already final pack)
 * Re-apply the deterministic video-pipeline@1 post-processing (style lock, 5–9s merge,
 * time/offlist/logo fixes, sceneId/carryFromPrev) to an already exported pack, and print stats.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { hasNightConflict, postProcessExportWithStats } from '../src/lib/segmentPost'
import type { VideoPipelineExport } from '../src/lib/videoExport'
import { applyBeatMode } from '../src/lib/beatPrompt'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const gi = args.indexOf('--genre')
const genre = gi >= 0 ? args[gi + 1] : ''
const bi = args.indexOf('--beat-mode')
const beatMode = bi >= 0 && args[bi + 1] === 'speed' ? 'speed' : flags.has('--beat-only') ? 'speed' : 'off'
const pos = args.filter((a, i) => !a.startsWith('--') && (gi < 0 || i !== gi + 1) && (bi < 0 || i !== bi + 1))
const [inp, outp] = pos
if (!inp) {
  console.error('usage: tsx scripts/repack.ts <in.json> [out.json] [--no-merge] [--genre G] [--beat-mode speed] [--beat-only]')
  process.exit(1)
}
const pack = JSON.parse(readFileSync(inp, 'utf8')) as VideoPipelineExport
const { exp, stats } = flags.has('--beat-only')
  ? { exp: applyBeatMode(pack), stats: null }
  : postProcessExportWithStats(pack, { mergeToSegments: !flags.has('--no-merge'), genre, beatMode })
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
      offscreenLines: exp.shots.filter((s) => s.speakerOffscreen || s.dialogueLines?.some((l) => l.voiceOnly)).length,
      warnings: warn,
      stats,
      ...(beatMode === 'speed'
        ? {
            beatMode,
            beatShots: exp.shots.filter((s) => s.beatMode === 'speed').length,
            beatTodoShots: exp.shots.filter((s) => s.beatTodo?.length).map((s) => ({ id: s.id, todo: s.beatTodo })),
            beatRemovedProps: exp.shots.filter((s) => s.beatRemovedProps?.length).map((s) => ({ id: s.id, removed: s.beatRemovedProps })),
          }
        : {}),
    },
    null,
    2,
  ),
)
