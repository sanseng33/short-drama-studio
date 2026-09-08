/** 都市逆袭 / 都市重生 · 真人短剧向模板 */
import type { Character, EpisodeOutline, EpisodeScript, Shot, ArtStyle } from '../../types'
import { styleTag } from './styleTag'

export const DUSHI_NIXI_CHARACTERS: Character[] = [
  {
    id: 'c1',
    name: '陈默',
    role: '男主·落魄逆袭',
    visualLock:
      '二十五岁东亚男性，短发微乱，剑眉深目，下巴浅疤，初期憔悴有青茬；逆袭后剃须干净、气场沉稳，真人写实面孔',
    costume: '初期皱巴旧西装+白衬衫；逆袭后修身黑西装、银袖扣、黑色腕表',
    signatureProp: '父亲留下的旧怀表（内藏股权芯片密钥）',
  },
  {
    id: 'c2',
    name: '林可',
    role: '女主·投行精英',
    visualLock:
      '二十四岁东亚女性，齐肩黑发侧分，杏眼，职业淡妆，气质干练带暖意，真人写实',
    costume: '米白西装套裙，细跟高跟鞋，珍珠耳钉',
    signatureProp: '红色笔记本（记录关键证据）',
  },
  {
    id: 'c3',
    name: '赵凯',
    role: '反派·假好友',
    visualLock:
      '二十六岁东亚男性，油头微卷，金丝眼镜，笑里藏刀，眼神飘忽，炫富感，真人写实',
    costume: '名牌运动外套+大金链；商务场合换成刺眼亮色西装',
    signatureProp: '伪造的股权转让书',
  },
]

export const DUSHI_CHONGSHENG_CHARACTERS: Character[] = [
  {
    id: 'c1',
    name: '沈星',
    role: '女主·都市重生',
    visualLock:
      '二十六岁东亚女性，及肩波浪黑发，眉眼凌厉，肤色冷白；重生后眼神更沉，真人写实面孔',
    costume: '初期廉价职场连衣裙；逆袭后黑色大衣+白衬衫+细链',
    signatureProp: '破碎的订婚戒（重生信物）',
  },
  {
    id: 'c2',
    name: '顾宴',
    role: '男主·隐秘总裁',
    visualLock:
      '二十九岁东亚男性，短寸微长，深目高鼻，常穿黑衣，气场压迫但不张扬，真人写实',
    costume: '哑光黑西装，无logo，黑色手套偶现',
    signatureProp: '黑卡与一枚旧钥匙',
  },
  {
    id: 'c3',
    name: '苏晚',
    role: '反派·白莲闺蜜',
    visualLock:
      '二十五岁东亚女性，甜美娃娃脸，粉色唇彩，笑起来无辜，眼神算计，真人写实',
    costume: '浅粉针织裙，名媛风首饰',
    signatureProp: '偷拍用的隐藏摄像头项链',
  },
]

const NIXI_TITLES = [
  '扫地出局', '怀表密钥', '夜会金主', '身价一夜', '假友翻脸',
  '证据到手', '董事会羞辱', '反向炸场', '林可站队', '资本围猎',
  '旧爱求复合', '芯片觉醒', '对手示弱', '媒体风暴', '家族秘密',
  '母亲的信', '暗网交易', '内鬼现身', '上市前夜', '赵凯崩溃',
  '怀表终极锁', '跨国局', '身份揭晓', '假死脱身', '王者归来',
  '清算开始', '华腾易主', '最终对赌', '当众打脸', '新王加冕',
]

const NIXI_HOOKS = [
  '陈默被当众撤职，赵凯笑着接过他的工位',
  '旧怀表弹出一串密钥：「你爸留给你的公司」',
  '凌晨三点，神秘投资人约见陈默',
  '账户余额暴涨八位数，助理跪着递名片',
  '赵凯伪造股权文件，想彻底踢走陈默',
  '林可把录音笔推过来：「这是他昨晚说的」',
  '董事会上全员嘲笑陈默是「富二代弃子」',
  '陈默亮出芯片，屏幕投出真实股权结构',
  '林可当众改口：「我站陈默」',
  '对手联手做空，陈默的新公司股价暴跌',
  '前任哭着求复合，陈默只回一个字：滚',
  '怀表AI苏醒：「下一局，用规则杀人」',
  '赵凯突然示弱，背后却在买凶',
  '热搜第一：陈默被诬「侵吞国资」',
  '保险柜里发现父亲血书',
  '母亲临终前藏起的U盘被打开',
  '暗网拍卖「陈氏核心专利」',
  '最信任的助理竟是赵凯安插的',
  '上市敲钟前夜，服务器被植入后门',
  '赵凯在直播里崩溃承认造假',
  '怀表打开终极锁：海外壳公司全归属陈默',
  '跨国资本围剿，陈默反将一军',
  '真实身份曝光：他才是华腾隐名控股人',
  '暗杀失败，陈默用替身假死脱身',
  '葬礼上他摘下墨镜，全场死寂',
  '清算名单发出，昔日嘲讽者连夜跑路',
  '华腾易主仪式，赵凯被请出大门',
  '对赌协议到期，陈默一口吞下对方股份',
  '发布会上陈默当面撕碎伪造合同',
  '新总部亮灯，林可站在他身侧',
]

const NIXI_SUMMARIES = [
  '华腾集团大厅，陈默被撤职扫地，赵凯当众羞辱并抢走客户资源。',
  '陈默回出租屋摆弄父亲旧怀表，意外触发芯片，发现隐秘股权证明。',
  '神秘金主以怀表密钥验证身份，提出注资，条件是七天内打脸董事会。',
  '资金到账，陈默气质与穿着焕然，前同事开始倒戈示好。',
  '赵凯抛出伪造转让书，试图合法吞并陈默名下股份。',
  '林可暗中录下赵凯行贿证据，夜里交给陈默。',
  '临时董事会上众人嘲讽，陈默沉默承受，埋下反转。',
  '陈默投影真实股权链，律师当场确认其控股地位。',
  '林可公开站队，投行资源倒向陈默。',
  '对手联合做空与舆论战，陈默公司陷入危机。',
  '前任以旧情要挟，陈默冷拒并曝光其帮凶角色。',
  '怀表AI给出规则战策略：用合规手段锁死对手。',
  '赵凯假和解，实则雇佣水军与黑客。',
  '诬陷热搜爆发，陈默召开发布会甩出时间线证据。',
  '保险柜血书揭示父亲被赵家陷害的真相。',
  '母亲U盘里是完整的资金流水与证人名单。',
  '暗网拍下专利后陈默反向追踪买家到赵凯。',
  '内鬼助理被抓，陈默以其人之道反制赵凯。',
  '上市前夜攻防战，陈默团队连夜清后门。',
  '赵凯直播翻车，证据链完整到无法抵赖。',
  '终极锁打开，海外资产并表，陈默身价封顶。',
  '国际资本逼宫，陈默用对赌条款反吞股份。',
  '隐名控股身份公开，华腾上下震动。',
  '暗杀局中陈默假死，暗中收集最后证据。',
  '亡者归来，媒体与警察同时到场。',
  '清算函发出，合作方排队切割赵凯。',
  '华腾交接，赵凯被保安请离。',
  '对赌结算日，陈默成为绝对控股人。',
  '发布会撕合同打脸，全网直播。',
  '新总部启用，陈默与林可定格胜利画面。',
]

const NIXI_CLIFFS = [
  '怀表突然震动，屏幕浮现：你父亲没有死。',
  '密钥指向一家从未听说过的空壳公司。',
  '金主摘下面具：竟是林可的顶头上司。',
  '赵凯发来短信：明天董事会，你完了。',
  '林可发来定位：我被他们堵在地下车库。',
  '录音最后一句话：把陈默做掉。',
  '大屏突然黑掉，只剩一行字：证据已毁。',
  '律师脸色煞白：这份股权链被抢先冻结了。',
  '林可接到匿名电话：别站错队。',
  '股价跌停板上出现神秘买家正在吸筹。',
  '前任包里掉出与赵凯的合影。',
  'AI说：真正的敌人不是赵凯。',
  '杀手照片发到陈默手机上——是他的脸。',
  '热搜评论区出现父亲生前录音。',
  '血书末尾有个陌生签名。',
  'U盘最后文件加密，密码是陈默生日。',
  '买家头像一闪：竟是林可的旧同事。',
  '助理临走甩下一句：你妈也知道。',
  '后门日志显示入侵者来自总裁办。',
  '赵凯喊出：你爸的死，我只是执行者。',
  '海外律师来电：有人要用你的名义卖公司。',
  '对赌对方背后出现国际投行Logo。',
  '公告弹出：另一位隐名股东投票反对。',
  '替身临死前塞给他一张卡片。',
  '镜头外有人举着逮捕令。',
  '名单第一行不是赵凯，是更高等级的名字。',
  '赵凯笑着说：我还有第二条命。',
  '对赌条款有一行小字被篡改过。',
  '撕碎的合同里夹着一张老照片。',
  '远景玻璃幕墙上，有人正在瞄准。',
]

const CS_TITLES = [
  '坠落前夜', '睁眼重生', '拒绝订婚', '撕破白莲', '顾宴出现',
  '证据反杀', '职场打脸', '旧婚约', '偷拍曝光', '官司开打',
  '母亲真相', '股权夺回', '苏晚崩溃', '假怀孕', '直播翻车',
  '顾宴护短', '前任求饶', '公司易主', '重生金句', '终极对峙',
  '保险箱', '境外逃亡', '身份互换', '婚礼崩盘', '当众宣判',
  '家族认主', '白莲落网', '新合同', '封心锁爱', '女王加冕',
]

const CS_HOOKS = [
  '沈星从高楼坠落前一秒，看见苏晚挽着渣男笑',
  '睁眼回到三年前订婚宴，她把戒指摔碎',
  '沈星当众拒绝联姻：「这次换我退婚」',
  '苏晚的白莲面具被当场揭穿',
  '顾宴挡在沈星身前：「碰她试试」',
  '沈星甩出偷拍原片，全场死寂',
  '会议上沈星用数据打脸空降总监',
  '旧婚约条款被她逐条撕掉',
  '项链摄像头的画面投上大屏',
  '民事起诉状拍在苏晚脸上',
  '母亲日记揭开沈星被换掉的身世线索',
  '沈星连夜夺回被盗的股权章',
  '苏晚在镜头前崩溃撕扯头发',
  '假怀孕报告被医院官方否认',
  '直播连麦翻车，苏晚人设崩塌',
  '顾宴公布沈星是项目真正控制人',
  '渣男跪地求饶，沈星只回：晚了',
  '公司公告：沈星出任董事长',
  '沈星对着镜头说出生前夜的预言',
  '天台再次对峙，这次她握住顾宴的手',
  '保险箱打开：全是针对她的构陷证据',
  '苏晚企图出境，机场被拦',
  '沈星用法律身份互换计反将一军',
  '婚礼现场沈星走到台上宣布真相',
  '判决书宣读，苏晚被带走',
  '沈家承认她的嫡女身份',
  '白莲团伙被捕的新闻刷屏',
  '顾宴递来新合同：平等合伙人',
  '沈星关掉复仇清单最后一项',
  '新总部剪彩，她成为真正的女王',
]

function pad(items: string[], n: number, fallback: string): string[] {
  return Array.from({ length: n }, (_, i) => items[i] ?? `${fallback}${i + 1}`)
}

export function buildDushiOutline(
  count: number,
  _title: string,
  mode: 'nixi' | 'chongsheng',
): EpisodeOutline[] {
  if (mode === 'chongsheng') {
    const titles = pad(CS_TITLES, count, '重生之章')
    const hooks = pad(CS_HOOKS, count, '沈星再次改写命运')
    return titles.map((t, i) => ({
      episode: i + 1,
      title: t,
      hook: hooks[i],
      summary: `${hooks[i]}。压抑后反手打脸，节奏加快。`,
      cliffhanger: `下一秒——${hooks[(i + 1) % count]}`,
    }))
  }
  const titles = pad(NIXI_TITLES, count, '逆袭之章')
  const hooks = pad(NIXI_HOOKS, count, '陈默再次出手')
  const summaries = pad(NIXI_SUMMARIES, count, '商战升级，打脸继续。')
  const cliffs = pad(NIXI_CLIFFS, count, '更大的阴谋浮出水面。')
  return titles.map((t, i) => ({
    episode: i + 1,
    title: t,
    hook: hooks[i],
    summary: summaries[i],
    cliffhanger: cliffs[i],
  }))
}

export function buildDushiScript(
  ep: number,
  outline: EpisodeOutline,
  chars: Character[],
  seconds: number,
  mode: 'nixi' | 'chongsheng',
): EpisodeScript {
  const hero = chars[0]
  const partner = chars[1]
  const villain = chars[2]
  const h = hero?.name || (mode === 'chongsheng' ? '沈星' : '陈默')
  const p = partner?.name || (mode === 'chongsheng' ? '顾宴' : '林可')
  const v = villain?.name || (mode === 'chongsheng' ? '苏晚' : '赵凯')

  const beats =
    mode === 'chongsheng'
      ? [
          {
            label: '【3秒钩子】',
            content: `订婚宴灯光刺眼，${v}挽着男人笑，${h}心跳如鼓——她记得自己三秒后会坠落。`,
            dialogue: `${h}（内心）：这次，绝不重来。`,
          },
          {
            label: '【冲突升级】',
            content: `${v}当众暗示${h}配不上联姻，宾客起哄；${h}站起，把订婚戒摔在大理石地面。`,
            dialogue: `${v}：姐，你别冲动——`,
          },
          {
            label: '【反转】',
            content: `${h}亮出「未来」关键截图（重生记忆），${v}脸色煞白；${p}在角落抬眼。`,
            dialogue: `${h}：你以为我什么都不知道？`,
          },
          {
            label: '【情绪高点】',
            content: `${p}走到${h}身侧挡开保镖，气场压场；宾客哗然，闪光灯狂闪。`,
            dialogue: `${p}：谁再逼她，就和我的律师团队聊。`,
          },
          {
            label: '【结尾悬念】',
            content: `${h}拾起碎戒，屏幕亮起未知短信：欢迎回到第0天。`,
            dialogue: `${h}：……谁？`,
          },
        ]
      : [
          {
            label: '【3秒钩子】',
            content: `华腾大厅，${h}被保安按住收拾纸箱，${v}拍手笑着接手他的工位。`,
            dialogue: `${v}：兄弟，该学会认命了。`,
          },
          {
            label: '【冲突升级】',
            content: `客户被当众挖走，同事起哄；${h}握紧旧怀表，指节发白。`,
            dialogue: `${h}：怀表……你到底藏了什么。`,
          },
          {
            label: '【反转】',
            content: `怀表弹出密钥投影，律师远程确认控股；${v}笑容僵住。`,
            dialogue: `${h}：从这一秒起，规矩我定。`,
          },
          {
            label: '【情绪高点】',
            content: `${p}推门而入递上证据袋，舆论与资本瞬间倒戈；大厅哗然。`,
            dialogue: `${p}：录音、转账、假合同，都在里面。`,
          },
          {
            label: '【结尾悬念】',
            content: `${h}走出大楼，手机震动：你父亲没有死。`,
            dialogue: `${h}：……什么？`,
          },
        ]

  const tag = mode === 'chongsheng' ? '都市重生·打脸复仇' : '都市逆袭·商战打脸'
  const fullText = [
    `# 第${ep}集《${outline.title}》`,
    `时长约 ${seconds} 秒｜${tag}`,
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
  const time =
    duration > 5
      ? `时间轴：0-${Math.min(2, duration)}s起幅定场；${Math.min(2, duration)}-${duration}s${action}。`
      : ''
  return [
    `竖屏9:16。主体：${subject}（视觉锁定：${lock}）。`,
    `动作：${action}（单主动作，表情克制真实）。`,
    `镜头：${camera}。`,
    `风格：${styleTag(style, 'dushi')}，电影级光影，高清。`,
    time,
    `限制：禁止二次元大眼睛；禁止夸张美颜磨皮；保持真人五官与服装一致；无字幕无水印；当代都市实景。`,
  ]
    .filter(Boolean)
    .join('')
}

export function buildDushiShots(
  ep: number,
  outline: EpisodeOutline,
  script: EpisodeScript,
  chars: Character[],
  style: ArtStyle,
  seconds: number,
  mode: 'nixi' | 'chongsheng',
): Shot[] {
  const hero = chars[0]
  const partner = chars[1]
  const villain = chars[2]
  const loc = mode === 'chongsheng' ? '五星酒店宴会厅' : '玻璃幕墙写字楼大堂'
  const prop = mode === 'chongsheng' ? '破碎的订婚戒' : '旧怀表'
  const propLock =
    mode === 'chongsheng' ? '碎裂钻石订婚戒，折射冷光' : '做旧银色怀表，表盖刻字'

  const patterns: Omit<Shot, 'id' | 'shotNo' | 'seedancePrompt'>[] = [
    {
      size: '远景',
      durationSec: 3,
      visual: `${loc}，冷白灯光，人群窃窃私语`,
      action: '镜头从门外缓缓推入大厅',
      dialogue: '',
      camera: '推',
      emotion: '压抑',
      groupNote: '镜头组A·开场定场',
    },
    {
      size: '中景',
      durationSec: 4,
      visual: `${villain?.name || '反派'}站在高处台阶，笑容得意`,
      action: `${villain?.name || '反派'}抬手指向下方，当众羞辱`,
      dialogue: script.beats[0]?.dialogue || '',
      camera: '固定',
      emotion: '嚣张',
      groupNote: '镜头组A·开场定场',
    },
    {
      size: '近景',
      durationSec: 3,
      visual: `${hero?.name || '主角'}低头，下颌线紧绷，眼神压抑`,
      action: '缓缓抬头，眼神转冷',
      dialogue: script.beats[1]?.dialogue || '',
      camera: '升',
      emotion: '隐忍转锋',
    },
    {
      size: '中景',
      durationSec: 5,
      visual: `${hero?.name || '主角'}与${villain?.name || '反派'}对峙，举起关键证据`,
      action: '亮出关键证据，全场哗然',
      dialogue: '',
      camera: '跟',
      emotion: '爆发',
      groupNote: '镜头组B·冲突',
    },
    {
      size: '特写',
      durationSec: 2,
      visual: '围观者手机举起拍摄，表情震惊',
      action: '反应镜头，倒吸凉气',
      dialogue: script.beats[2]?.dialogue || '',
      camera: '固定',
      emotion: '震惊',
      groupNote: '镜头组B·冲突',
    },
    {
      size: '近景',
      durationSec: 4,
      visual: `${partner?.name || '助力'}侧脸入画，气场冷静`,
      action: '上前半步挡开人群',
      dialogue: script.beats[3]?.dialogue || '',
      camera: '摇',
      emotion: '撑腰',
    },
    {
      size: '特写',
      durationSec: 3,
      visual: `${prop}特写，光斑扫过`,
      action: '道具轻微震动或反光一次',
      dialogue: '',
      camera: '推',
      emotion: '悬疑',
      groupNote: '镜头组C·悬念',
    },
    {
      size: '中景',
      durationSec: Math.max(3, seconds - 24),
      visual: `${hero?.name || '主角'}背影走出旋转门，城市夜景霓虹`,
      action: '停顿回眸，留下悬念',
      dialogue: script.beats[4]?.dialogue || '',
      camera: '拉',
      emotion: '余韵/悬念',
      groupNote: '镜头组C·悬念',
    },
  ]

  return patterns.map((pat, i) => {
    const subject =
      i === 1
        ? villain?.name || '反派'
        : i === 5
          ? partner?.name || '助力'
          : i === 6
            ? prop
            : hero?.name || '主角'
    const vlock =
      i === 1
        ? villain?.visualLock || ''
        : i === 5
          ? partner?.visualLock || ''
          : i === 6
            ? propLock
            : hero?.visualLock || ''
    return {
      id: `s${ep}-${i + 1}`,
      shotNo: i + 1,
      ...pat,
      seedancePrompt: seedance(
        subject,
        pat.action,
        `${pat.camera}镜头，${pat.size}`,
        style,
        vlock,
        pat.durationSec,
      ),
    }
  })
}
