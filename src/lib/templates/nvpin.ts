/** 女频重生·嫡女复仇 模板引擎数据 */
import type { Character, EpisodeOutline, EpisodeScript, Shot, ArtStyle } from '../../types'

export const NVPIN_CHARACTERS: Character[] = [
  {
    id: 'c1',
    name: '沈清婉',
    role: '女主·重生嫡女',
    visualLock:
      '十九岁女子，乌发高盘点翠钗，凤眼桃花，肤若凝脂，左耳下一枚泪痣，气质从柔弱转为杀伐果断',
    costume: '初期淡粉襦裙（伪装柔弱）；觉醒后玄紫广袖华服，腰束金丝带',
    signatureProp: '母亲遗留的白玉簪（内藏致命银针）',
  },
  {
    id: 'c2',
    name: '顾承衍',
    role: '男主·权臣世子',
    visualLock:
      '二十二岁男子，墨发束冠，剑眉星目，薄唇常带浅笑，身姿挺拔如松，眼底偶尔闪过冷意',
    costume: '玄色官袍绣暗纹金线，腰佩白玉佩',
    signatureProp: '玄铁令牌（可调禁军）',
  },
  {
    id: 'c3',
    name: '沈清荷',
    role: '反派·庶妹白莲',
    visualLock:
      '十八岁少女，梨花带雨容貌，杏眼无辜，嘴角常含怯生生笑意，实则阴毒',
    costume: '素白纱裙，外罩浅绿披帛，装作清雅',
    signatureProp: '伪造的「嫡女信物」手帕',
  },
]

const TITLES = [
  '重生夜', '庶妹的眼泪', '退婚局', '白玉簪', '宴会交锋',
  '母亲旧案', '暗卫来投', '皇商线', '毒哑之谜', '侧妃阴谋',
  '顾承衍示好', '假戏真做', '府中偷听', '掉包嫁衣', '刑部线索',
  '庶母现形', '冷宫密信', '结盟世子', '朝堂风波', '掉包证据',
  '前世仇人', '血染喜堂', '身份反转', '皇上召见', '清算开始',
  '庶妹崩溃', '沈府易主', '大婚之约', '前朝秘辛', '凤印在手',
]

const HOOKS = [
  '喜堂变刑场——沈清婉被庶妹一杯毒酒毒哑，再被推进火海',
  '火光中睁眼，竟回到被退婚的三年前！',
  '庶妹沈清荷梨花带雨：「姐姐，我不是故意的……」',
  '沈清婉摸到袖中白玉簪，眼神骤冷',
  '寿宴上，庶妹当众「不小心」弄脏她的裙摆',
  '翻出母亲旧匣，发现一封未寄出的求救信',
  '窗外黑影翻入——竟是前世死忠的暗卫归来',
  '皇商账本被调包，沈府面临抄家危机',
  '前世毒哑的药方，在庶母梳妆台出现',
  '侧妃候选人名单上，赫然有沈清荷的名字',
  '顾承衍递来一块帕子：「姑娘，可需要帮忙？」',
  '两人当众演戏互认「青梅」，全场哗然',
  '夜探书房，听见庶母与奸细密谋',
  '大婚嫁衣被换成素服——有人要当众羞辱她',
  '刑部旧档记载：母亲「病逝」当晚有外人进出',
  '庶母在佛堂「撞鬼」，实则被沈清婉设计',
  '冷宫旧人送来密信：先皇后与沈母有旧',
  '顾承衍提出合作：「你报仇，我取权」',
  '早朝弹劾沈府，沈清婉临危不乱当庭对质',
  '掉包的嫁衣线牵出宫中贵人',
  '前世害死她的「贵人」今日上门提亲',
  '喜堂上她反过来端起那杯酒',
  '公布亲子鉴定式物证：谁才是真正嫡女',
  '皇上宣她入宫，抛出惊天条件',
  '沈清婉手握证据链，开始逐个点名',
  '沈清荷当众撕破白莲面具，丑态毕露',
  '沈府家主之位，转到她名下',
  '顾承衍下聘：这一次，她说了算',
  '前朝秘辛揭开：她的血脉关乎国本',
  '凤印入手，庶妹跪地求饶——她只淡淡一笑',
]

const SUMMARIES = [
  '前世大婚日，沈清婉被庶妹沈清荷设计毒哑并放火灭口，含恨而死。',
  '重生回到退婚前夕，她决定改写命运，先稳住沈清荷，暗中布局。',
  '面对庶妹演技，沈清婉以柔克刚，当众送她「和解礼物」（实为窃听香囊）。',
  '白玉簪中银针确认仍在，她开始重建母亲留下的暗线人脉。',
  '寿宴交锋，沈清婉借题发挥，让沈清荷的「无心」变成众人笑柄。',
  '旧信曝光母亲死得蹊跷，她决定查案与复仇并行。',
  '暗卫阿隼回归，成为她在府外的眼睛与刀子。',
  '皇商线被做空，她联手顾府压下风波，反将一军。',
  '确认毒方出自庶母，证据却还不足以掀翻整房。',
  '得知沈清荷意图进宫，沈清婉决定先截胡她的靠山。',
  '顾承衍主动示好，各取所需的联盟初现。',
  '二人演戏传绯闻，逼得沈清荷阵脚大乱。',
  '偷听得悉「掉包嫁衣」与「毒酒」的完整计划。',
  '她将计就计，让掉包嫁衣变成庶妹自己的丑闻。',
  '刑部线索指向当年「病逝」实为毒杀。',
  '庶母在局中失态，露出对沈母的嫉恨真面目。',
  '冷宫密信证明沈母曾护过先皇后遗孤相关秘密。',
  '与顾承衍正式结盟，交换情报与朝堂资源。',
  '朝堂风波中她据理力争，沈府声望反升。',
  '证据链合拢，宫中贵人被点名。',
  '仇人提亲，她笑纳聘礼却埋下更大的坑。',
  '喜堂反杀：毒酒归还，舆论一边倒。',
  '当众证明嫡庶身份与罪行，沈清荷崩盘。',
  '皇上看中她的手段，许下护身与权柄。',
  '清算名单启动，债主上门讨债的不再是她。',
  '庶妹彻底疯魔，当众诬陷反被打脸。',
  '沈府易主，她成为真正的掌事嫡女。',
  '大婚之约重提，这一次她掌控节奏。',
  '前朝秘辛公开一角，政敌不敢轻动。',
  '凤印在手，她完成从受害者到掌权者的闭环。',
]

const CLIFFS = [
  '火光中，沈清婉听见自己的心跳——她活了？！',
  '铜镜中的脸，是十九岁还未被毁容的自己！',
  '香囊里的细线，连向庶妹卧房……',
  '簪尖银光一闪，她低语：「这一世，换我来。」',
  '顾承衍在角落遥遥举杯，似笑非笑。',
  '信末一行小字：「若我死，必是……」墨迹被撕。',
  '阿隼单膝跪地：「主子，此生唯命是从。」',
  '账房密室中，沈清荷正在烧毁账本！',
  '药渣中检出的，正是前世那味「哑药」。',
  '名单背后，还有一个被涂黑的名字——沈清婉。',
  '顾承衍耳语：「你前世死的那天，我也在场。」',
  '沈清荷咬牙：「姐姐，你变了……」',
  '密谋者补了一句：「事成后，把顾世子也……」',
  '喜娘打开箱子：里面是一套丧服！',
  '档册夹缝里，掉出一枚沈府家徽残片。',
  '佛堂铜镜碎裂，映出庶母恐惧的脸。',
  '密信最后：「孩子，若见此信，速寻顾……」',
  '顾承衍摊开另一半地图：「神器在此。」',
  '御史大夫突然转向她：「沈小姐，你可敢对质？」',
  '贵人轿中伸出的手，戴着与毒案相同的扳指。',
  '提亲帖上的字迹——与退婚书出自同一人。',
  '酒杯递到唇边，全场屏息。',
  '她展开的，是庶妹亲笔写下的「毒杀计划」。',
  '皇上：「朕给你一个选择，也很危险。」',
  '第一份弹劾折子，盖着她的私印。',
  '沈清荷扑向她，袖中滑出匕首！',
  '家主印落下的一刻，全府跪倒。',
  '聘礼抬进门时，雨忽然停了。',
  '密卷封面写着她的小名——只有母亲知道的那个。',
  '凤印金光中，远处宫门再次打开……（季终）',
]

export function buildNvpinOutline(count: number, _title: string): EpisodeOutline[] {
  const n = Math.min(Math.max(count, 1), 30)
  return Array.from({ length: n }, (_, i) => ({
    episode: i + 1,
    title: TITLES[i] || `第${i + 1}集`,
    hook: HOOKS[i] || `第${i + 1}集开场`,
    summary: SUMMARIES[i] || `第${i + 1}集剧情`,
    cliffhanger: CLIFFS[i] || '悬念待续……',
  }))
}

export function buildNvpinScript(
  ep: number,
  outline: EpisodeOutline,
  chars: Character[],
  seconds: number,
): EpisodeScript {
  const hero = chars[0]?.name || '沈清婉'
  const heroMale = chars[1]?.name || '顾承衍'
  const villain = chars[2]?.name || '沈清荷'
  const beats = [
    {
      label: '【3秒钩子】',
      content: outline.hook,
      dialogue: `${villain}（楚楚可怜）：「姐姐，你别吓我……」`,
    },
    {
      label: '【冲突升级】',
      content: outline.summary,
      dialogue: `${hero}（淡然）：「无妨，我慢慢奉陪。」`,
    },
    {
      label: '【反转】',
      content: `${hero}布局生效，${villain}的陷害反噬自身，场面逆转。`,
      dialogue: `旁人惊呼：「这……怎么会是清荷做的？」`,
    },
    {
      label: '【情绪高点】',
      content: `${heroMale}介入或情感线升温，权谋与心动并行。`,
      dialogue: `${heroMale}（低声）：「需要我的时候，折这半枚玉佩。」`,
    },
    {
      label: '【结尾悬念】',
      content: outline.cliffhanger,
      dialogue: `旁白：棋局，才刚刚开始……`,
    },
  ]
  const fullText = [
    `# 第${ep}集《${outline.title}》`,
    `时长约 ${seconds} 秒｜女频重生嫡女复仇`,
    '',
    ...beats.flatMap((b) => [b.label, b.content, b.dialogue ? `台词：${b.dialogue}` : '', '']),
  ].join('\n')
  return { episode: ep, title: outline.title, beats, fullText }
}

function seedance(
  subject: string,
  action: string,
  camera: string,
  style: ArtStyle,
  lock: string,
  duration: number,
): string {
  const styleTag =
    style === '2D国风'
      ? '2D国风古装动画，精致服饰纹样，柔光水墨背景'
      : '2D日漫古风，细腻瞳孔高光，柔和色调'
  const time =
    duration > 5
      ? `时间轴：0-${Math.min(2, duration)}s情绪铺垫；${Math.min(2, duration)}-${duration}s${action}。`
      : ''
  return [
    `竖屏9:16。主体：${subject}（视觉锁定：${lock}）。`,
    `动作：${action}（单主动作，表情戏优先，手部克制）。`,
    `镜头：${camera}。`,
    `风格：${styleTag}，电影级光影，高清。`,
    time,
    `限制：禁止手部乱摸乱抓；禁止人物从画框边缘突然进入；五官服饰严格一致；无字幕无水印。`,
  ]
    .filter(Boolean)
    .join('')
}

export function buildNvpinShots(
  ep: number,
  outline: EpisodeOutline,
  script: EpisodeScript,
  chars: Character[],
  style: ArtStyle,
  seconds: number,
): Shot[] {
  const hero = chars[0]
  const heroMale = chars[1]
  const villain = chars[2]
  const lock = hero?.visualLock || '乌发女子'
  const patterns: Omit<Shot, 'id' | 'shotNo' | 'seedancePrompt'>[] = [
    {
      size: '远景',
      durationSec: 3,
      visual: '红烛喜堂或沈府夜景，气氛诡异压抑',
      action: '镜头缓慢横移过红幔',
      dialogue: '',
      camera: '移',
      emotion: '压抑',
      groupNote: '镜头组A·开场',
    },
    {
      size: '近景',
      durationSec: 4,
      visual: `${hero?.name || '女主'}凤眼含寒，泪痣清晰`,
      action: '缓缓抬眸，从柔弱转为锋利',
      dialogue: script.beats[0]?.dialogue || '',
      camera: '推',
      emotion: '觉醒',
      groupNote: '镜头组A·开场',
    },
    {
      size: '中景',
      durationSec: 4,
      visual: `${villain?.name || '庶妹'}梨花带雨，素白纱裙`,
      action: '抬手拭泪，偷瞄女主反应',
      dialogue: '',
      camera: '固定',
      emotion: '伪善',
    },
    {
      size: '中景',
      durationSec: 5,
      visual: '二人对峙于厅堂，仆人屏息',
      action: `${hero?.name || '女主'}将「礼物」递给庶妹`,
      dialogue: script.beats[1]?.dialogue || '',
      camera: '摇',
      emotion: '暗战',
      groupNote: '镜头组B·交锋',
    },
    {
      size: '特写',
      durationSec: 2,
      visual: '白玉簪尖一闪，银针若隐若现',
      action: '指尖轻触簪身',
      dialogue: '',
      camera: '固定',
      emotion: '杀意',
      groupNote: '镜头组B·交锋',
    },
    {
      size: '近景',
      durationSec: 4,
      visual: `${heroMale?.name || '男主'}墨发束冠，浅笑`,
      action: '遥遥举杯或递帕，意味深长',
      dialogue: script.beats[3]?.dialogue || '',
      camera: '跟',
      emotion: '暧昧/权谋',
    },
    {
      size: '特写',
      durationSec: 3,
      visual: '密信/账本/酒杯关键道具特写',
      action: '烛火晃动，字迹或药渣入画',
      dialogue: '',
      camera: '推',
      emotion: '悬疑',
      groupNote: '镜头组C·悬念',
    },
    {
      size: '中景',
      durationSec: Math.max(3, seconds - 25),
      visual: `${hero?.name || '女主'}立于廊桥或窗前，夜色衬托`,
      action: '转身入暗，留下未尽之言',
      dialogue: script.beats[4]?.dialogue || '',
      camera: '拉',
      emotion: '余韵',
      groupNote: '镜头组C·悬念',
    },
  ]

  return patterns.map((p, i) => {
    const subject =
      i === 2
        ? villain?.name || '庶妹'
        : i === 5
          ? heroMale?.name || '男主'
          : i === 4 || i === 6
            ? '关键道具'
            : hero?.name || '女主'
    const vlock =
      i === 2
        ? villain?.visualLock || lock
        : i === 5
          ? heroMale?.visualLock || lock
          : i === 4
            ? '白玉簪，簪尖藏银针'
            : i === 6
              ? '烛火下的密信与印章'
              : lock
    return {
      id: `s${ep}-${i + 1}`,
      shotNo: i + 1,
      ...p,
      seedancePrompt: seedance(subject, p.action, `${p.camera}镜头，${p.size}`, style, vlock, p.durationSec),
    }
  })
}
