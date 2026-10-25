/**
 * src/ must carry no show data: every character name / baseName / characterKey, prop and place label of the
 * real project JSON (p2-clean) is grepped in src/ and must not appear (code, comments, LLM prompt examples, UI).
 * Place labels are checked whole (教室·日) and by their place part (教室); the only exemption is a short list of
 * common place nouns the generic place detector must recognise in any script.
 * Run: npx tsx scripts/test-no-show-strings.ts [project.json]
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const P2 = process.argv[2] || '/workspace/h3/projects/小黄鸭砸出个帅系统-video-pipeline-p2-clean.json'
/** common nouns, not show data: the place detector needs them as vocabulary */
export const COMMON_PLACE_NOUNS = new Set(['教室', '奶茶店'])

export function showTerms(p: { characters?: Record<string, unknown>[]; shots?: Record<string, unknown>[]; project?: Record<string, unknown> }): { kind: string; term: string }[] {
  const out = new Map<string, string>()
  const add = (kind: string, v: unknown) => {
    for (const x of Array.isArray(v) ? v : [v]) {
      const s = typeof x === 'string' ? x.trim() : typeof x === 'object' && x && 'name' in x ? String((x as { name: unknown }).name).trim() : ''
      if (s.length >= 2 && !out.has(s)) out.set(s, kind)
    }
  }
  for (const c of p.characters || []) {
    add('name', c.name)
    add('baseName', c.baseName)
    add('characterKey', c.characterKey)
    add('prop', c.signatureProp)
    add('prop', c.props)
  }
  for (const s of p.shots || []) {
    for (const k of ['sceneLabel', 'location']) {
      const v = s[k]
      if (typeof v !== 'string' || !v) continue
      add('place label', v)
      const place = v.split(/[·・]/)[0]
      if (!COMMON_PLACE_NOUNS.has(place)) add('place label', place)
    }
  }
  return [...out].map(([term, kind]) => ({ kind, term }))
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|jsx|json|css|html)$/.test(f) ? [p] : []
  })
}

let n = 0
const t = (name: string, fn: () => void) => {
  fn()
  n++
  console.log('✓', name)
}

t('showTerms collects names, keys, props and place labels', () => {
  const terms = showTerms({
    characters: [{ name: '甲（之前）', baseName: '甲甲', characterKey: 'jia', signatureProp: '红伞', props: [{ name: '旧相机' }] }],
    shots: [{ sceneLabel: '海边灯塔·夜' }, { sceneLabel: '教室·日' }],
  }).map((x) => x.term)
  for (const w of ['甲（之前）', '甲甲', 'jia', '红伞', '旧相机', '海边灯塔·夜', '海边灯塔', '教室·日']) assert.ok(terms.includes(w), w)
  assert.ok(!terms.includes('教室'), 'common place noun exempt')
})

if (existsSync(P2)) {
  t('src/ contains no character name, characterKey, prop or place label of the project JSON', () => {
    const p = JSON.parse(readFileSync(P2, 'utf8'))
    const terms = showTerms(p)
    assert.ok(terms.length >= 5, `too few terms: ${terms.length}`)
    const hits: string[] = []
    for (const f of files(join(import.meta.dirname, '..', 'src'))) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((l, i) => {
        for (const { kind, term } of terms) if (l.includes(term)) hits.push(`${f.replace(/^.*\/src\//, 'src/')}:${i + 1} ${kind} 「${term}」`)
      })
    }
    assert.deepEqual(hits, [], hits.join('\n'))
  })
} else console.log('(p2-clean project JSON not found, src grep skipped)')

console.log(`\n${n} no-show-strings tests passed`)
