/**
 * Generic emotion / psychology vocabulary → visible face + body action (prompt builder data, not show content).
 * Video models draw abstract emotion words as on-screen text (e.g. 「不服」 in frame → OCR reject); every final prompt
 * shows the feeling as expression / gesture instead. Extend by adding entries (longest match wins).
 * Temperament words of a character's look (自信 / 冷静 / 倔强 in visualLock) are out of scope: character data.
 */
/** Every visible part must be expression-level (actionWeight 0 in actionDensity): a rewrite may never add a main
 *  action to a beat that is already at its density cap. Extend freely; the tests enforce this. */
export const EMOTION_VISIBLE: Record<string, string> = {
  不服气: '皱眉、撇嘴',
  不服: '皱眉、撇嘴',
  尴尬: '视线乱飘、嘴角僵住',
  得意: '嘴角上扬、下巴微抬',
  紧张: '指节发白、喉结滚动',
  害怕: '肩膀缩起、往后缩',
  惊恐: '瞳孔放大、往后缩',
  恐惧: '瞳孔放大、往后缩',
  惊讶: '眼睛睁大、嘴微张',
  吃惊: '眼睛睁大、嘴微张',
  震惊: '瞪大眼睛、身体僵住',
  错愕: '眼睛一睁、动作顿住',
  委屈: '嘴角下撇、眼眶泛红',
  生气: '眉头紧锁、咬紧牙关',
  愤怒: '眉头紧锁、咬紧牙关',
  恼火: '眉头紧锁、咬紧牙关',
  懊恼: '咬住下唇、拍一下额头',
  无奈: '眉毛塌下、轻叹一口气',
  认命: '肩膀一垮、轻轻点头',
  害羞: '低头、耳根泛红',
  羞涩: '低头、耳根泛红',
  嫌弃: '皱鼻、身子后仰',
  心虚: '视线躲闪、不敢对视',
  崩溃: '抱头、肩膀垮下',
  慌乱: '眼神乱扫、手足无措',
  慌张: '眼神乱扫、手足无措',
  心慌: '眼神乱扫、手足无措',
  窘迫: '脖子发红、手不知往哪放',
  局促: '手不知往哪放、身体绷紧',
  别扭: '身体侧开、眼神不看对方',
  硬撑: '咬着牙、挺直背',
  憋屈: '抿紧嘴、胸口起伏',
  疲惫: '眼皮发沉、肩膀下垂',
  困惑: '眉头微皱、歪头',
  疑惑: '眉头微皱、歪头',
  迷茫: '眼神发直、眉头微皱',
  茫然: '眼神发直、眉头微皱',
  迟疑: '动作顿住半拍',
  犹豫: '动作顿住半拍',
  不确定: '眼神游移',
  镇定: '呼吸放平、表情不动',
  平静: '表情放松、呼吸平稳',
  坦然: '目光平视、肩膀放松',
  敷衍: '眼皮半垂、头也不抬',
  漫不经心: '眼神随意扫过',
  不安: '手指不停摩挲',
  挑衅: '挑眉、下巴一抬',
  慵懒: '眼皮半垂、动作放慢',
  空落: '目光放空',
  狼狈: '手忙脚乱',
  期待: '眼睛发亮、目光追着看',
  防备: '身体后缩、手臂护在身前',
  开心: '笑开、眼睛弯起',
  高兴: '笑开、眼睛弯起',
  兴奋: '笑开、眼睛发亮',
  失落: '眼神黯下去、嘴角下垂',
  难过: '眼神黯下去、嘴角下垂',
  伤心: '眼神黯下去、嘴角下垂',
  沮丧: '眼神黯下去、嘴角下垂',
  焦虑: '呼吸发紧、来回张望',
  着急: '动作加快、频频张望',
  烦躁: '皱眉、身体来回挪动',
  不耐烦: '皱眉、嘴角下压',
  不屑: '斜眼、嘴角一撇',
  轻蔑: '斜眼、嘴角一撇',
  鄙夷: '斜眼、嘴角一撇',
  羞愧: '低头、不敢对视',
  愧疚: '低头、不敢对视',
  感动: '眼眶发红、抿紧嘴唇',
  嫉妒: '盯着对方、咬紧后槽牙',
  无语: '翻个白眼、嘴角抽动',
}

/** inner-monologue markers: a clause carrying one is not visible → dropped */
export const INNER_MONOLOGUE = ['心想', '心里', '暗想', '心中', '内心', '心声', '心底', '心道', '暗忖']

/** wrappers around an emotion word consumed with it (一脸X / 带着X / 有点X / X地 / X的样子 …) */
export const EMOTION_PREFIX = ['一脸', '满脸', '一副', '带着', '带点', '略带', '有点', '有些', '透着', '透出', '显得', '满是', '难掩', '写满', '掩不住', '藏不住']
export const EMOTION_SUFFIX = ['的神情', '的表情', '的样子', '的模样', '劲儿', '劲', '感', '地']
