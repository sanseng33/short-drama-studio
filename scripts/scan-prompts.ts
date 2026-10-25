/**
 * npx tsx scripts/scan-prompts.ts <pack.json> — QA scan of a final video-pipeline pack (generic, no show data):
 * subject vs on-screen cast / wardrobe state, framing vs header / camera / 景别, 无人物 vs people, repeated phrases.
 * Prints JSON { shots, anomalies: [{ id, kind, detail }] }.
 */
import { readFileSync } from 'node:fs'
import { isNearDup, splitClauses, BEAT_LINE_RE } from '../src/lib/beatPrompt'
import { CLOSEUP_CAMERA, castDescription, onscreenCast, type WardrobeMeta } from '../src/lib/shotAnnotate'
import type { VideoPipelineExport } from '../src/lib/videoExport'

const GARMENTS = /夹克|卫衣|校服|衬衫|西装|T恤|外套|连衣裙|毛衣|风衣|大衣|睡衣|背心|制服|围裙|运动服/g
const SIZE = /大全景|中全景|全景|远景|中近景|近景特写|近景|中景|特写/g

export function scanPack(e: VideoPipelineExport): { id: string; kind: string; detail: string }[] {
  const chars = e.characters as WardrobeMeta[]
  const byId = new Map(chars.map((c) => [c.id, c]))
  const out: { id: string; kind: string; detail: string }[] = []
  const add = (id: string, kind: string, detail: string) => out.push({ id, kind, detail })
  for (const s of e.shots) {
    const lines = s.prompt.split('\n')
    const on = onscreenCast(s, chars)
    const n = on.length
    const subj = lines.find((l) => l.startsWith('主体：')) || (s.prompt.match(/主体：[^。\n]*/)?.[0] ?? '')
    const cam = s.prompt.match(/镜头：([^。\n]*)/)?.[1] || ''
    const head = lines[0]
    // ---- subject
    if (n >= 2) {
      const parts = subj.split('；')
      if (parts.length !== n) add(s.id, 'subject', `${n} on screen, ${parts.length} subject parts`)
      if (new Set(parts.map((p) => p.replace(/^.*?其.：/, ''))).size < parts.length) add(s.id, 'subject', 'identical character descriptions')
    }
    if (n === 1) {
      if (/另一人|其二/.test(subj)) add(s.id, 'subject', 'solo shot with a second subject')
      const c = byId.get(on[0])
      if (c && subj) {
        const state = s.wardrobeState?.[on[0]] || ''
        const want = new Set(castDescription(c, state, chars).text.match(GARMENTS) || [])
        const said = [...new Set(subj.match(GARMENTS) || [])].filter((g) => !want.has(g) && !(g === '外套' && want.has('校服')) && !(g === '校服' && want.has('外套')))
        if (want.size && said.length) add(s.id, 'subject', `garment ${said.join('/')} not in ${on[0]}:${state} outfit (${[...want].join('/')})`)
      }
    }
    if (n === 0 && subj) add(s.id, 'subject', 'empty shot with a subject line')
    // ---- framing vs header / camera / 景别
    const headCount = /空镜/.test(head) ? 0 : /单人/.test(head) ? 1 : /双人/.test(head) ? 2 : /多人/.test(head) ? 3 : -1
    if (headCount >= 0 && Math.min(headCount, 3) !== Math.min(n, 3)) add(s.id, 'framing', `header says ${headCount} people, ${n} on screen`)
    const sizes = cam.match(SIZE) || []
    if (s.framing === 'closeup_dialogue' && !cam.startsWith(CLOSEUP_CAMERA)) add(s.id, 'camera', `closeup without close-up camera wording: ${cam}`)
    if (s.framing === 'medium' && sizes.some((x) => !/^(?:中景|中近景)$/.test(x))) add(s.id, 'camera', `medium with ${sizes.join('/')}: ${cam}`)
    if (s.framing === 'medium' && n >= 2 && !/双人中景|多人中景/.test(cam)) add(s.id, 'camera', `medium two-shot not read as two-shot: ${cam}`)
    if (s.framing === 'full' && sizes.some((x) => !/全景|远景/.test(x))) add(s.id, 'camera', `full with ${sizes.join('/')}: ${cam}`)
    if (s.framing !== 'closeup_dialogue' && cam.includes(CLOSEUP_CAMERA)) add(s.id, 'camera', `close-up wording on ${s.framing}`)
    // ---- people vs 无人物
    const body = lines.slice(1).filter((l) => !/^(?:风格|限制|景别|光线)/.test(l)).join('\n')
    if (n > 0 && /无人物|空镜|没有人物/.test(body)) add(s.id, 'contradiction', '无人物 / 空镜 with people on screen')
    if (n === 0 && /(?<!其)他|她|少年|神情|眼神|嘴角|开口/.test(body.replace(/没有人物|无人物/g, ''))) add(s.id, 'contradiction', 'person words in an empty shot')
    // ---- a bare 他/她 in a multi-person segment does not say who acts (info, not an error)
    if (n >= 2) {
      const amb = lines.filter((l) => BEAT_LINE_RE.test(l) && /(?<!其)[他她](?!们)/.test(l.split('；')[0]))
      if (amb.length) add(s.id, 'pronoun', `${amb.length} segment(s) use a bare 他/她 with ${n} on screen`)
    }
    // ---- repeated phrases inside a segment / across the timeline
    const segs = lines.filter((l) => BEAT_LINE_RE.test(l)).map((l) => l.replace(/^[^：]*：/, ''))
    for (const seg of segs) {
      const cls = splitClauses(seg.split('；')[0])
      for (let i = 0; i < cls.length; i++)
        for (let j = i + 1; j < cls.length; j++) if (isNearDup(cls[i], cls[j])) add(s.id, 'repeat', `${cls[i]} / ${cls[j]}`)
    }
    // across segments: clause-level repeats, then any verbatim 5-char run (character reference labels like 穿X的少年 excluded)
    const all = segs.map((x) => splitClauses(x.split('；')[0]))
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        for (const a of all[i]) for (const b of all[j]) if (isNearDup(a, b)) add(s.id, 'repeat', `across segments: ${a} / ${b}`)
    const tl = segs.map((x) => x.split('；')[0].replace(/穿[^，。；]{1,6}?的(?:少年|少女|男人|女人|人)/g, '|')).join('|')
    const seen = new Set<string>()
    for (let i = 0; i + 5 <= tl.length; i++) {
      const sub = tl.slice(i, i + 5)
      if (/[|，。；]/.test(sub) || seen.has(sub)) continue
      if (tl.indexOf(sub, i + 5) >= 0) {
        seen.add(sub)
        add(s.id, 'repeat', `phrase「${sub}」twice in the timeline`)
        i += 4
      }
    }
  }
  return out
}

if (process.argv[2]) {
  const e = JSON.parse(readFileSync(process.argv[2], 'utf8')) as VideoPipelineExport
  console.log(JSON.stringify({ shots: e.shots.length, anomalies: scanPack(e) }, null, 2))
}
