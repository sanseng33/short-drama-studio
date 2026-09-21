/** Flexible script / storyboard builders — cast-size aware, never invents missing roles. */
import type {
  ArtStyle,
  Character,
  EpisodeOutline,
  EpisodeScript,
  ScriptBeat,
  Shot,
} from '../../types'
import {
  resolveCast,
  suggestedBeatCount,
  suggestedShotCount,
  type ResolvedCast,
} from './cast'
import { styleTag } from './styleTag'

export interface Flavor {
  genreLabel: string
  openingVisual: string
  propName: string
  propLock: string
  styleTone: 'xianxia' | 'gufeng' | 'dushi'
}

function seedance(
  subject: string,
  action: string,
  camera: string,
  style: ArtStyle,
  lock: string,
  duration: number,
  tone: Flavor['styleTone'],
): string {
  const time =
    duration > 5
      ? `时间轴：0-${Math.min(2, duration)}s起幅定场；${Math.min(2, duration)}-${duration}s${action}。`
      : ''
  return [
    `竖屏9:16。主体：${subject}（视觉锁定：${lock}）。`,
    `动作：${action}（单主动作，手脚清晰克制）。`,
    `镜头：${camera}。`,
    `风格：${styleTag(style, tone)}，电影级光影，高清。`,
    time,
    `限制：禁止多余手部乱摸；禁止从画框边缘突然闯入；保持角色五官与服装一致；无字幕无水印。`,
  ]
    .filter(Boolean)
    .join('')
}

function partnerOf(cast: ResolvedCast): Character | undefined {
  return cast.romantic || cast.deuteragonist || cast.mentor || cast.support[0]
}

export function buildFlexibleScript(
  ep: number,
  outline: EpisodeOutline,
  chars: Character[],
  seconds: number,
  flavor: Flavor,
): EpisodeScript {
  const cast = resolveCast(chars)
  const hero = cast.protagonist.name
  const foe = cast.antagonist?.name
  const mate = partnerOf(cast)?.name
  const mentor = cast.mentor?.name
  const extra = cast.support[0]?.name
  const n = suggestedBeatCount(chars.length, seconds)

  const pool: ScriptBeat[] = []

  pool.push({
    label: '【3秒钩子】',
    content: outline.hook,
    dialogue: foe
      ? `${foe}（压迫）：「${hero}，今天就到此为止。」`
      : `${hero}（内心）：「再退一步，就真的完了。」`,
  })

  pool.push({
    label: '【冲突升级】',
    content: outline.summary,
    dialogue: `${hero}（咬牙）：「……我记住了。」`,
  })

  if (n >= 4) {
    pool.push({
      label: '【阻力】',
      content: foe
        ? `${foe}加码施压，局面更糟；${hero}看似无路。`
        : `规则与偏见同时压向${hero}，退路被切断。`,
      dialogue: foe
        ? `${foe}：「求饶，或许我还能留你。」`
        : `旁白：所有人都等着看${hero}倒下。`,
    })
  }

  pool.push({
    label: '【反转】',
    content: `${hero}亮出意料之外的手段/证据/力量，场面瞬间翻转。`,
    dialogue: `围观者：「这怎么可能？！」`,
  })

  if (n >= 5 && (mate || mentor || extra)) {
    const who = mate || mentor || extra!
    const isMentor = Boolean(mentor && who === mentor)
    pool.push({
      label: '【关系节拍】',
      content: `${who}出现并${isMentor ? '点拨' : '站队'}，推动主线（不强行恋爱）。`,
      dialogue: isMentor
        ? `${who}（低声）：「记住，你要赢的是自己。」`
        : `${who}：「我站你。」`,
    })
  } else if (n >= 5) {
    pool.push({
      label: '【情绪高点】',
      content: `${hero}独自顶住压力，第一次真正握住属于自己的力量。`,
      dialogue: `${hero}：「从现在起，规矩我说了算。」`,
    })
  }

  if (n >= 6 && cast.support.length > 1) {
    const s = cast.support[1]
    pool.push({
      label: '【配角侧写】',
      content: `${s.name}带来关键信息，扩大世界视角。`,
      dialogue: `${s.name}：「你以为这只是私人恩怨？」`,
    })
  }

  pool.push({
    label: '【结尾悬念】',
    content: outline.cliffhanger,
    dialogue: `旁白：下一秒，更大的棋局揭开……`,
  })

  const beats = pool.slice(0, Math.max(3, n))
  if (beats[beats.length - 1]?.label !== '【结尾悬念】') {
    beats[beats.length - 1] = {
      label: '【结尾悬念】',
      content: outline.cliffhanger,
      dialogue: `旁白：下一秒，更大的棋局揭开……`,
    }
  }

  const fullText = [
    `# 第${ep}集《${outline.title}》`,
    `时长约 ${seconds} 秒｜${flavor.genreLabel}`,
    `出场：${chars.map((c) => `${c.name}（${c.role}）`).join('、')}`,
    '',
    ...beats.flatMap((b) => [b.label, b.content, b.dialogue ? `台词：${b.dialogue}` : '', '']),
  ].join('\n')

  return { episode: ep, title: outline.title, beats, fullText }
}

export function buildFlexibleShots(
  ep: number,
  _outline: EpisodeOutline,
  script: EpisodeScript,
  chars: Character[],
  style: ArtStyle,
  seconds: number,
  flavor: Flavor,
): Shot[] {
  const cast = resolveCast(chars)
  const hero = cast.protagonist
  const foe = cast.antagonist
  const mate = partnerOf(cast)
  const target = suggestedShotCount(chars.length, seconds)
  const dlg = (i: number) => script.beats[i]?.dialogue || ''

  type Pat = Omit<Shot, 'id' | 'shotNo' | 'seedancePrompt'> & {
    subject: string
    lock: string
  }

  const patterns: Pat[] = [
    {
      size: '远景',
      durationSec: 3,
      visual: flavor.openingVisual,
      action: '镜头缓缓推入场景',
      dialogue: '',
      camera: '推',
      emotion: '定场',
      groupNote: '镜头组A·开场',
      subject: '场景',
      lock: flavor.openingVisual,
    },
  ]

  if (foe) {
    patterns.push({
      size: '中景',
      durationSec: 4,
      visual: `${foe.name}占据高位或中心，气场压迫`,
      action: `${foe.name}抬手示意或开口施压`,
      dialogue: dlg(0),
      camera: '固定',
      emotion: '压迫',
      groupNote: '镜头组A·开场',
      subject: foe.name,
      lock: foe.visualLock,
    })
  } else {
    patterns.push({
      size: '中景',
      durationSec: 4,
      visual: '环境细节暗示危机（监控、公文、符阵余烬）',
      action: '危机符号入画，气氛收紧',
      dialogue: dlg(0),
      camera: '推',
      emotion: '不安',
      groupNote: '镜头组A·开场',
      subject: '危机符号',
      lock: '具体物件与光影，写实清晰',
    })
  }

  patterns.push({
    size: '近景',
    durationSec: 3,
    visual: `${hero.name}压抑神情，细节符合视觉锁定`,
    action: '缓缓抬头，眼神转锋',
    dialogue: dlg(1),
    camera: '升',
    emotion: '隐忍转锋',
    subject: hero.name,
    lock: hero.visualLock,
  })

  patterns.push({
    size: '中景',
    durationSec: 5,
    visual: foe
      ? `${hero.name}与${foe.name}对峙，关键动作发生`
      : `${hero.name}独自完成关键翻转动作`,
    action: '完成单一主动作，场面哗然',
    dialogue: '',
    camera: '跟',
    emotion: '爆发',
    groupNote: '镜头组B·冲突',
    subject: hero.name,
    lock: hero.visualLock,
  })

  patterns.push({
    size: '特写',
    durationSec: 2,
    visual: '围观者或物件的反应特写',
    action: '震惊/碎裂/数据跳动等反应',
    dialogue: dlg(2),
    camera: '固定',
    emotion: '震惊',
    groupNote: '镜头组B·冲突',
    subject: '反应',
    lock: '情绪反应清晰，避免杂乱手指',
  })

  if (mate && target >= 6) {
    patterns.push({
      size: '近景',
      durationSec: 4,
      visual: `${mate.name}入画，态度明确`,
      action: '上前半步或递出关键物',
      dialogue: dlg(Math.min(3, script.beats.length - 1)),
      camera: '摇',
      emotion: '助力',
      subject: mate.name,
      lock: mate.visualLock,
    })
  }

  if (
    cast.support[0] &&
    target >= 8 &&
    (!mate || cast.support[0].id !== mate.id)
  ) {
    const s = cast.support[0]
    patterns.push({
      size: '中景',
      durationSec: 3,
      visual: `${s.name}在侧翼观察或行动`,
      action: '给出一个清楚的信息动作',
      dialogue: '',
      camera: '移',
      emotion: '侧写',
      subject: s.name,
      lock: s.visualLock,
    })
  }

  patterns.push({
    size: '特写',
    durationSec: 3,
    visual: `${flavor.propName}特写`,
    action: '物件轻微震动或反光一次',
    dialogue: '',
    camera: '推',
    emotion: '悬疑',
    groupNote: '镜头组C·悬念',
    subject: flavor.propName,
    lock: flavor.propLock,
  })

  patterns.push({
    size: '中景',
    durationSec: 4,
    visual: `${hero.name}背影离开或伫立，留下余韵`,
    action: '停顿回眸或决然迈步',
    dialogue: dlg(script.beats.length - 1),
    camera: '拉',
    emotion: '余韵/悬念',
    groupNote: '镜头组C·悬念',
    subject: hero.name,
    lock: hero.visualLock,
  })

  let chosen = patterns.slice(0, target)
  if (chosen.length < target) {
    chosen.push({
      size: '近景',
      durationSec: 3,
      visual: `${hero.name}呼吸未定，握紧标志物`,
      action: '手指收紧，眼神确认下一步',
      dialogue: '',
      camera: '固定',
      emotion: '决意',
      subject: hero.name,
      lock: hero.visualLock,
    })
    chosen = chosen.slice(0, target)
  }

  const used = chosen.reduce((s, p) => s + p.durationSec, 0)
  const last = chosen[chosen.length - 1]
  last.durationSec = Math.max(3, last.durationSec + (seconds - used))

  return chosen.map((p, i) => {
    const { subject, lock, ...rest } = p
    return {
      id: `s${ep}-${i + 1}`,
      shotNo: i + 1,
      ...rest,
      seedancePrompt: seedance(
        subject,
        p.action,
        `${p.camera}镜头，${p.size}`,
        style,
        lock,
        p.durationSec,
        flavor.styleTone,
      ),
    }
  })
}
