/** 男频玄幻·废柴逆袭 模板引擎数据 */
import type { Character, EpisodeOutline, EpisodeScript, Shot, ArtStyle } from '../../types'

export const XUANHUAN_CHARACTERS: Character[] = [
  {
    id: 'c1',
    name: '林尘',
    role: '男主·废柴逆袭',
    visualLock:
      '十八岁少年，黑发微乱，右眉一道细疤，深邃黑瞳带金芒闪烁，清瘦但肩线利落，气质从隐忍到锋利',
    costume: '破旧青灰色短打外袍，腰束旧皮带，后期换玄黑镶金边长袍',
    signatureProp: '锈迹斑斑的青铜古戒（体内封印上古神魂）',
  },
  {
    id: 'c2',
    name: '苏清雪',
    role: '女主·宗门天才',
    visualLock:
      '十七岁少女，银白长发及腰，冰蓝瞳孔，鹅蛋脸，气质清冷如霜，眉心一点淡青莲印',
    costume: '白底蓝纹仙裙，外披半透明纱罩，腰佩冰晶佩',
    signatureProp: '寒冰玉笛',
  },
  {
    id: 'c3',
    name: '赵无极',
    role: '反派·宗门少主',
    visualLock:
      '二十岁青年，金棕短发竖起，狭长凤眼，薄唇常带讥笑，面容英俊但眼神阴鸷',
    costume: '金纹红袍，肩披白狐裘，腰悬赤焰剑',
    signatureProp: '赤焰剑',
  },
]

const TITLES = [
  '废柴之名', '退婚之辱', '古戒觉醒', '一夜蜕变', '宗门大比',
  '初露锋芒', '暗处杀机', '秘境开启', '夺宝之争', '生死一线',
  '苏清雪的秘密', '神魂低语', '突破筑基', '赵无极的阴谋', '血战峡谷',
  '宗主试探', '内门资格', '冰封谷底', '双修机缘', '背叛者现身',
  '上古残卷', '灵兽契约', '黑市拍卖', '假死脱身', '身份揭晓',
  '复仇序章', '宗门崩塌', '神域降临', '最终对决', '新王加冕',
]

const HOOKS = [
  '退婚大会上，全场嘲笑林尘是万年废柴',
  '林尘握紧古戒，体内突然涌起陌生力量',
  '古戒中传来苍老声音：「小子，想变强吗？」',
  '一夜之间，林尘修为暴涨三个大境界',
  '宗门大比抽签，林尘对上赵无极心腹',
  '一招秒杀！全场死寂',
  '黑衣人夜袭，目标直指林尘的古戒',
  '秘境入口开启，三宗弟子蜂拥而入',
  '宝物出世，林尘与赵无极狭路相逢',
  '林尘重伤倒地，古戒却突然发光',
  '苏清雪悄悄递来疗伤丹，「别死」',
  '神魂告知：你体内封印的是……',
  '筑基成功！天象异变，引来宗主注意',
  '赵无极收买长老，要在比武中杀林尘',
  '峡谷伏击战，林尘一人对十',
  '宗主召见，「你身上有上古气息」',
  '内门考核，林尘故意压低修为',
  '冰封谷底发现上古遗迹',
  '双修阵启动，林尘与苏清雪气息交融',
  '师兄竟是赵无极的内应！',
  '残卷记载：古戒主人曾灭一界',
  '幼龙认主，林尘多了一位兽伴',
  '黑市拍卖惊现「封印钥匙」',
  '假死计成功，敌人以为他已亡',
  '真实身份：上古神帝转世？',
  '林尘归来，昔日嘲讽者瑟瑟发抖',
  '赵无极引爆宗门护山大阵',
  '神域裂缝打开，各方势力降临',
  '最终战场：天劫之下的对决',
  '新王登基，苏清雪立于身侧',
]

const SUMMARIES = [
  '林尘在青云宗被当众退婚，苏家千金苏婉拒绝联姻，赵无极落井下石。',
  '退婚当晚，林尘在废柴谷被追杀，危急时刻古戒发热，神秘力量护体。',
  '古戒中沉睡的上古神魂苏醒，提出交易：助他变强，换取自由之日。',
  '在神魂指导下，林尘以秘法淬体，一夜跨过炼气三层，气质大变。',
  '宗门大比开始，林尘报名外门组，众人以为他是来送人头。',
  '首战碾压对手，林尘展露「破军拳」，苏清雪在观战席上微微侧目。',
  '赵无极派出杀手，林尘凭借古戒预警险胜，决心加速变强。',
  '万年秘境开启，林尘混入队伍，目标是传说中的筑基丹。',
  '秘境中抢夺灵草，林尘与赵无极短暂交锋，双方各退一步。',
  '遭遇三阶妖兽，同伴逃散，林尘独自周旋并触发古戒禁制。',
  '苏清雪现身救援，二人合作击退妖兽，她发现林尘的异常。',
  '神魂透露：林尘前世是神域战神，今世要收回散落神格。',
  '借助秘境灵气，林尘强行突破筑基，天降雷云，震动三宗。',
  '赵无极联合外门长老设局，要在「切磋」中废掉林尘丹田。',
  '血战峡谷中林尘反杀伏兵，首次动用神魂之力，威压全场。',
  '宗主夜召林尘，暗示知其秘密，但不点破，给予资源拉拢。',
  '内门考核林尘稳扎稳打，故意不拿第一，暗中观察敌人布局。',
  '考核地点冰封谷底，林尘发现与古戒共鸣的上古祭坛。',
  '祭坛双修阵误触，林尘与追来的苏清雪被困，二人关系微妙升温。',
  '师兄陈阳暴露内奸身份，偷走祭坛核心碎片交给赵无极。',
  '林尘追回碎片，残卷显示古戒能开启神域通道。',
  '幼龙从蛋中破壳认主，成为林尘的契约灵兽「小黯」。',
  '为筹集资源，林尘乔装进入黑市，拍下封印钥匙却暴露行踪。',
  '赵无极围杀，林尘借假死符逃脱，全宗以为他已死。',
  '隐匿三月后林尘归来，修为已至金丹，身份传闻沸腾。',
  '林尘逐一清算旧日仇敌，苏清雪选择站到他身边。',
  '赵无极狗急跳墙，引爆护山大阵，青云宗陷入火海。',
  '神域裂缝撕开天空，上古势力使者降临，要夺古戒。',
  '林尘与赵无极天劫中决战，苏清雪以玉笛封印赵无极退路。',
  '战后林尘成为新任宗主，宣布改革，苏清雪与他并肩而立。',
]

const CLIFFS = [
  '古戒突然剧烈震动——里面有东西要出来！',
  '追杀者身后，竟是苏清雪的身影……',
  '神魂冷笑：「你以为变强是免费的？」',
  '门外传来赵无极的声音：「废柴，该受死了。」',
  '对手竟是……苏清雪本人？！',
  '观战席上，宗主眼中闪过一丝震惊。',
  '杀手临死前低语：「少主说……古戒归他。」',
  '秘境深处，一双冰冷的眼睛睁开了。',
  '赵无极举起赤焰剑：「这次，我要你的命。」',
  '古戒裂开一道缝，金光冲天！',
  '苏清雪转身离去前丢下一句：「别信任何人。」',
  '神魂：「你前世的仇敌，已经找到你了。」',
  '雷云中降下第二道劫雷——比预想强十倍！',
  '切磋场上，裁判长老悄悄换了一枚毒针。',
  '峡谷尽头，出现了第三波伏兵……',
  '宗主：「把古戒给我看看，如何？」',
  '考核榜上，林尘名字旁多了一个红叉标记。',
  '祭坛中央，一具冰封的女尸缓缓睁眼。',
  '双修阵失控，两人修为开始互相吞噬！',
  '陈阳冷笑：「赵少主给你带了句话——」',
  '残卷最后一页写着林尘的本名！',
  '小黯突然发狂，咬向苏清雪的方向。',
  '拍卖行屋顶，赵无极的人已经包围。',
  '「林尘已死」的消息传遍三宗——他却在暗处冷笑。',
  '使者单膝跪地：「神帝陛下，请回神域。」',
  '苏清雪拔出玉笛：「从今天起，我护着你。」',
  '护山大阵核心，赵无极手中握着林尘的「尸体」。',
  '裂缝中伸出一只遮天巨手！',
  '赵无极燃烧精血，化身魔神形态！',
  '远处天际，又一道神域裂缝正在形成……（季终）',
]

export function buildXuanhuanOutline(count: number, title: string): EpisodeOutline[] {
  const n = Math.min(Math.max(count, 1), 30)
  return Array.from({ length: n }, (_, i) => ({
    episode: i + 1,
    title: TITLES[i] || `第${i + 1}集`,
    hook: HOOKS[i] || `第${i + 1}集开场冲突`,
    summary: SUMMARIES[i]?.replace(/林尘/g, title.includes('尘') ? '林尘' : '男主') || `第${i + 1}集剧情推进`,
    cliffhanger: CLIFFS[i] || '下一集更精彩……',
  }))
}

export function buildXuanhuanScript(
  ep: number,
  outline: EpisodeOutline,
  chars: Character[],
  seconds: number,
): EpisodeScript {
  const hero = chars[0]?.name || '林尘'
  const heroine = chars[1]?.name || '苏清雪'
  const villain = chars[2]?.name || '赵无极'
  const beats = [
    {
      label: '【3秒钩子】',
      content: outline.hook,
      dialogue: `${villain}（嘲讽）：「${hero}，今天就是你的死期！」`,
    },
    {
      label: '【冲突升级】',
      content: outline.summary,
      dialogue: `${hero}（咬牙）：「你们……等着。」`,
    },
    {
      label: '【反转】',
      content: `局面急转：${hero}展现出众人意想不到的力量/计谋，现场哗然。`,
      dialogue: `围观者甲：「这怎么可能？！他不是废柴吗？」`,
    },
    {
      label: '【情绪高点】',
      content: `${heroine}相关线索或态度变化，推动情感线与主线交织。`,
      dialogue: `${heroine}（低声）：「你……到底是谁？」`,
    },
    {
      label: '【结尾悬念】',
      content: outline.cliffhanger,
      dialogue: `旁白：下一集，答案即将揭晓……`,
    },
  ]
  const fullText = [
    `# 第${ep}集《${outline.title}》`,
    `时长约 ${seconds} 秒｜男频玄幻废柴逆袭`,
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
  const styleTag = style === '2D国风' ? '2D国风仙侠动画，细腻线稿，水墨晕染背景' : '2D日漫风格，赛璐璐上色，高对比光影'
  const time =
    duration > 5
      ? `时间轴：0-${Math.min(2, duration)}s起幅定场；${Math.min(2, duration)}-${duration}s${action}。`
      : ''
  return [
    `竖屏9:16。主体：${subject}（视觉锁定：${lock}）。`,
    `动作：${action}（单主动作，手脚动作清晰克制）。`,
    `镜头：${camera}。`,
    `风格：${styleTag}，电影级光影，高清。`,
    time,
    `限制：禁止多余手部特写乱摸；禁止从画框边缘突然闯入；保持角色五官与服装一致；无字幕无水印。`,
  ]
    .filter(Boolean)
    .join('')
}

export function buildXuanhuanShots(
  ep: number,
  outline: EpisodeOutline,
  script: EpisodeScript,
  chars: Character[],
  style: ArtStyle,
  seconds: number,
): Shot[] {
  const hero = chars[0]
  const heroine = chars[1]
  const villain = chars[2]
  const lock = hero?.visualLock || '黑发少年'
  const patterns: Omit<Shot, 'id' | 'shotNo' | 'seedancePrompt'>[] = [
    {
      size: '远景',
      durationSec: 3,
      visual: `青云宗山门广场，乌云压顶，人群围观`,
      action: '镜头缓缓推近广场中央',
      dialogue: '',
      camera: '推',
      emotion: '压抑',
      groupNote: '镜头组A·开场定场',
    },
    {
      size: '中景',
      durationSec: 4,
      visual: `${villain?.name || '反派'}立于高台，金纹红袍猎猎`,
      action: `${villain?.name || '反派'}抬手指向下方，嘴角讥笑`,
      dialogue: script.beats[0]?.dialogue || '',
      camera: '固定',
      emotion: '嚣张',
      groupNote: '镜头组A·开场定场',
    },
    {
      size: '近景',
      durationSec: 3,
      visual: `${hero?.name || '男主'}低着头，拳头紧握，右眉细疤清晰`,
      action: '缓缓抬头，眼中金芒一闪',
      dialogue: script.beats[1]?.dialogue || '',
      camera: '升',
      emotion: '隐忍转锋',
    },
    {
      size: '中景',
      durationSec: 5,
      visual: `${hero?.name || '男主'}与对手对峙，灵气波动`,
      action: '出拳命中，对方倒飞',
      dialogue: '',
      camera: '跟',
      emotion: '爆发',
      groupNote: '镜头组B·冲突',
    },
    {
      size: '特写',
      durationSec: 2,
      visual: '围观者震惊的脸，瞳孔放大',
      action: '反应镜头，倒吸凉气',
      dialogue: script.beats[2]?.dialogue || '',
      camera: '固定',
      emotion: '震惊',
      groupNote: '镜头组B·冲突',
    },
    {
      size: '近景',
      durationSec: 4,
      visual: `${heroine?.name || '女主'}银白长发，冰蓝瞳，侧脸观战`,
      action: '微微侧目，指尖轻触玉笛',
      dialogue: script.beats[3]?.dialogue || '',
      camera: '摇',
      emotion: '好奇',
    },
    {
      size: '特写',
      durationSec: 3,
      visual: `青铜古戒裂缝渗出金光`,
      action: '金光脉动一次，戒指轻微震动',
      dialogue: '',
      camera: '推',
      emotion: '悬疑',
      groupNote: '镜头组C·悬念',
    },
    {
      size: '中景',
      durationSec: Math.max(3, seconds - 24),
      visual: `${hero?.name || '男主'}背影立于广场，风吹衣袂`,
      action: '转身离去，留下未说完的秘密感',
      dialogue: script.beats[4]?.dialogue || '',
      camera: '拉',
      emotion: '余韵/悬念',
      groupNote: '镜头组C·悬念',
    },
  ]

  return patterns.map((p, i) => {
    const subject =
      i === 1
        ? villain?.name || '反派'
        : i === 5
          ? heroine?.name || '女主'
          : i === 6
            ? '青铜古戒'
            : hero?.name || '男主'
    const vlock =
      i === 1
        ? villain?.visualLock || lock
        : i === 5
          ? heroine?.visualLock || lock
          : i === 6
            ? '锈迹青铜古戒，表面符文'
            : lock
    return {
      id: `s${ep}-${i + 1}`,
      shotNo: i + 1,
      ...p,
      seedancePrompt: seedance(subject, p.action, `${p.camera}镜头，${p.size}`, style, vlock, p.durationSec),
    }
  })
}
