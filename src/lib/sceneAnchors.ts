/**
 * In-scene décor / size / camera anchors: later shots may omit an axis, but must not name an opposing set
 * (marble vs wood, chandelier present vs explicitly absent, full-body vs mid-shot, etc.).
 */

export type AnchorKind = 'decor' | 'size' | 'camera' | 'staging'

export interface SceneAnchor {
  axis: string
  group: string
  kind: AnchorKind
  term: string
}

export interface AnchorConflict {
  axis: string
  kind: AnchorKind
  left: string
  right: string
  detail: string
}

interface AxisGroup {
  id: string
  label: string
  terms: RegExp[]
}

interface AxisDef {
  axis: string
  kind: AnchorKind
  label: string
  groups: AxisGroup[]
}

const AXES: AxisDef[] = [
  {
    axis: 'table_material',
    kind: 'decor',
    label: '桌面材质',
    groups: [
      { id: 'marble', label: '大理石', terms: [/大理石/] },
      { id: 'wood', label: '原木', terms: [/原木/, /胡桃木/, /实木/] },
    ],
  },
  {
    axis: 'chandelier',
    kind: 'decor',
    label: '吊灯',
    groups: [
      { id: 'present', label: '有吊灯', terms: [/(?<![无没不])(?:水晶)?吊灯/] },
      { id: 'absent', label: '无吊灯', terms: [/无(?:水晶)?吊灯/, /没有(?:水晶)?吊灯/, /不(?:见|设|挂)(?:水晶)?吊灯/] },
    ],
  },
  {
    axis: 'sheer',
    kind: 'decor',
    label: '纱帘',
    groups: [
      { id: 'present', label: '有白纱', terms: [/(?<![无没不])(?:白纱|纱帘)/] },
      { id: 'absent', label: '无白纱', terms: [/无(?:白纱|纱帘)/, /没有(?:白纱|纱帘)/] },
    ],
  },
  {
    axis: 'flowers',
    kind: 'decor',
    label: '鲜花',
    groups: [
      { id: 'present', label: '有鲜花', terms: [/(?<![无没不])(?:鲜花|花艺|花束)/] },
      { id: 'absent', label: '无鲜花', terms: [/无(?:鲜花|花艺|花束)/, /没有(?:鲜花|花艺|花束)/] },
    ],
  },
  {
    axis: 'shot_size',
    kind: 'size',
    label: '景别',
    groups: [
      { id: 'full', label: '全身/全景', terms: [/大远景/, /远景/, /全身/, /全景/] },
      { id: 'mid', label: '中景/中全景', terms: [/中全景/, /膝上/, /中景/] },
      { id: 'close', label: '近景/特写', terms: [/大特写/, /特写/, /近景/] },
    ],
  },
  {
    axis: 'camera_angle',
    kind: 'camera',
    label: '机位',
    groups: [
      { id: 'rear', label: '正后', terms: [/正后/, /背后/, /背对镜头/, /背对/] },
      { id: 'rear_side', label: '侧后方', terms: [/侧后方/, /侧后/] },
    ],
  },
  {
    axis: 'apron_side',
    kind: 'staging',
    label: '开场朝向',
    groups: [
      { id: 'back_ties', label: '背后系带', terms: [/背后系带/, /后系带/] },
      { id: 'front_panel', label: '围裙正面', terms: [/围裙正面/, /正面面板/] },
    ],
  },
]

function firstGroup(def: AxisDef, text: string): SceneAnchor | null {
  // longest match wins so 中全景 is not classified as 全景, 无吊灯 is not 吊灯
  let best: SceneAnchor | null = null
  for (const g of def.groups) {
    for (const re of g.terms) {
      const m = text.match(re)
      if (m && (!best || m[0].length > best.term.length)) {
        best = { axis: def.axis, group: g.id, kind: def.kind, term: m[0] }
      }
    }
  }
  return best
}

/** Extract one group per axis from free text (inventory or shot prose). */
export function extractAnchors(text: string): SceneAnchor[] {
  const t = text || ''
  if (!t.trim()) return []
  const out: SceneAnchor[] = []
  for (const def of AXES) {
    const hit = firstGroup(def, t)
    if (hit) out.push(hit)
  }
  return out
}

export function shotAnchorText(s: {
  visual?: string
  camera?: string
  size?: string
  seedancePrompt?: string
  prompt?: string
  action?: string
  startState?: unknown
}): string {
  const state =
    s.startState && typeof s.startState === 'object' ? JSON.stringify(s.startState) : ''
  return [s.visual, s.camera, s.size, s.seedancePrompt, s.prompt, s.action, state].filter(Boolean).join('。')
}

export function conflictingAnchors(left: SceneAnchor[], right: SceneAnchor[]): AnchorConflict[] {
  const out: AnchorConflict[] = []
  const rightBy = new Map(right.map((a) => [a.axis, a]))
  for (const a of left) {
    const b = rightBy.get(a.axis)
    if (!b || b.group === a.group) continue
    const kind = a.kind
    const label = AXES.find((d) => d.axis === a.axis)?.label || a.axis
    out.push({
      axis: a.axis,
      kind,
      left: a.term,
      right: b.term,
      detail: `${label}冲突：${a.term} vs ${b.term}`,
    })
  }
  return out
}

/** Later shots may introduce new axes; opposing groups on a shared axis are conflicts. */
export function mergeAnchors(base: SceneAnchor[], extra: SceneAnchor[]): SceneAnchor[] {
  const by = new Map(base.map((a) => [a.axis, a]))
  for (const a of extra) if (!by.has(a.axis)) by.set(a.axis, a)
  return [...by.values()]
}

export function formatDecorAnchors(anchors: SceneAnchor[]): string {
  return anchors
    .filter((a) => a.kind === 'decor' || a.kind === 'staging')
    .map((a) => a.term)
    .join('、')
}

export function inventoryToText(inv: unknown): string {
  if (!inv) return ''
  if (typeof inv === 'string') return inv
  if (typeof inv !== 'object') return ''
  const o = inv as Record<string, unknown>
  const parts: string[] = []
  const push = (v: unknown) => {
    if (Array.isArray(v)) parts.push(v.map(String).join('、'))
    else if (v != null && String(v).trim()) parts.push(String(v))
  }
  push(o.text)
  push(o.decor)
  push(o.size)
  push(o.camera)
  push(o.staging)
  return parts.join('。')
}
