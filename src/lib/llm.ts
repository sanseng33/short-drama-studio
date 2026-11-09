import type { LlmSettings } from '../types'

/** Accept host or `.../v1` — always end with `/v1`. Empty base is an error. */
function normalizeBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/$/, '')
  if (!base) {
    throw new Error('未配置 Base URL，请在设置中填写（例如 https://api.deepseek.com/v1）。')
  }
  if (!base.endsWith('/v1')) base = `${base}/v1`
  return base
}

export async function chatCompletion(
  settings: LlmSettings,
  system: string,
  user: string,
  opts: { signal?: AbortSignal; temperature?: number } = {},
): Promise<string> {
  if (!settings.apiKey.trim()) {
    throw new Error('未配置 API Key，请改用「模板生成」或在设置中填写密钥。')
  }
  const base = normalizeBaseUrl(settings.baseURL)
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: opts.temperature ?? 0.85,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM 请求失败 (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('LLM 返回为空')
  return text
}

export const OUTLINE_SYSTEM = `你是资深AI短剧/漫剧编剧。输出严格 JSON 数组，每项含 episode,title,hook,summary,cliffhanger。中文。用户给出的「设定事实」与角色身份/家境/年龄是硬约束，必须遵守，不得改写成题材套路（如把富裕角色写成落魄/底层）。不要臆造用户未提供的角色。角色列表有谁就写谁，不要求男主+女主+反派齐全。不要markdown围栏。`

export const SCRIPT_SYSTEM = `你是短剧编剧。输出中文分集剧本。节拍可按故事需要变化（不必固定五段），建议覆盖钩子/冲突/反转/悬念等要素，含对白。适合60-90秒竖屏。严格使用用户提供的角色列表，禁止擅自补齐「女主/男主/反派」。若只有一名角色，就写单人张力戏。
设定事实与角色身份/家境/住处/年龄为硬约束，必须遵守，不得与之矛盾；不要套用「逆袭/底层/落魄」等题材套路改写人物出身；不要自行编造与设定冲突的年龄、年份或时间跨度（如「十年」），没有给出就不写具体数字。
每场戏开头写场景标题：「场N 地点 · 时间（清晨/早上/白天/黄昏/夜）」，时间必须与剧情和设定（如「早上7点」）一致。`

export const STORYBOARD_SYSTEM = `你是工业分镜师。输出 JSON 数组，字段：shotNo,size,durationSec,visual,action,dialogue,camera,emotion,seedancePrompt,groupNote,characters,voiceOnly,sfx,overlayText,timeOfDay,location,establishing,carryFromPrev,screenPos,startState,endState,cameraSide,eyeline,voiceMode,blocking,lighting,realm。
establishing：换地点/换时间后的第一镜为 true（远景/全景交代环境），否则 false；carryFromPrev：与上一镜同地点同时间且画面连续为 true，否则 false；screenPos：两人同框时 {"角色名":"left|right"}，同一场固定不变，单人或无人为 {}。
characters：本镜【画面内出场】角色名数组（必须是用户角色列表中的 name 原文；角色有造型变体如「甲（之前）」「甲（之后）」时必须写当前剧情对应的变体全名；无人物镜头为 []）。
voiceOnly：只闻其声不在画面内的角色名数组（画外音/OS/电话里），没有则 []。
硬性规则（视频模型每镜渲染为一个 5–9 秒片段，按台词时长剪辑）：
0. 画风锁定：seedancePrompt 的「风格：」子句必须原样照抄用户给出的【画风句】，全片统一；禁止自创或混入其它画风词（真人都市项目严禁出现 2D/日漫/动漫/赛璐璐/二次元/线稿/漫画）。
1. 每镜 durationSec 为 5–9 秒（整数或 .5），全集时长之和等于本集时长；每集约「本集秒数÷7」镜（75 秒约 9–13 镜）。每镜是一个小节拍（mini-beat）：剧情主动作 + 反应，或 一句台词 + 说话前后的微表演/听者反应，用时间轴写清前后段。
2. 每镜只有一个「剧情主动作」（如扔鸡蛋、推窗、扫码）。禁止把两个剧情主动作用「随后/然后/接着/紧接着」串在同一镜；连续剧情动作必须拆镜。
   但是：表演微动作不算违规「同时」——每镜 action 必须包含 1–2 个可见微行为（视线落点、眨眼、吞咽、手指收紧、重心转移、呼吸起伏、嘴角延迟等），可用「一边…一边…」描写微动作依附于主动作。
3. 台词按 4 字/秒 + 标点停顿 + 0.7 秒余量估算，必须在本镜内说完（9 秒镜约 ≤26 字），放不下就拆镜或删减。
4. 每镜最多一个说话人，dialogue 必须以「名字：」开头，如「林川：……」「林川（冷笑）：……」；画外音写「名字（OS）：……」并放入 voiceOnly；旁白写「旁白：……」；无台词写空字符串 ""（不要写「无」）。不在角色列表里的龙套必须写身份前缀，如「收银员：……」「路人甲：……」，不要省略名字；龙套/同学/老师等配角只闻其声、不出镜（画外音），不要放进 characters，visual/seedancePrompt 不得描绘该人（画面里不出现角色列表以外的人物正脸）。
5. 音效单独放 sfx 数组（如 ["砰","玻璃碎裂"]），不要写进 dialogue/action。
6. 系统界面/弹窗/转盘/屏幕文字等 UI 内容只放 overlayText 数组（后期叠加），系统说的话也放 overlayText，不要作为台词。
7. 永远不要让视频模型渲染 UI 或文字：visual/seedancePrompt 中不要描述视窗、文字、界面内容（间接光线线索由导出程序按需添加，不要自行在每镜开头写固定套话）。overlayText 只用于界面/系统文字；任何人物说的话（包括「……行。」之类短句）都写进 dialogue，绝不放 overlayText。overlayText 只写要叠加的界面原文（如「本月第47枚」），不要写「限制：不出现文字」之类约束或画面描述。
8. 优先单人镜头；对话用过肩/正反打，同框最多2人。
   对白硬性节拍：每一轮「A说→B说」之间必须有听者反应——写在同一镜后半段（时间轴后段：听者微表情/握道具/环境声画），不得说话头连打；不要把 2–3 秒的纯反应单独成镜。
   节奏：全集禁止超过一半镜头 durationSec 取同一个数；短节拍 5–6 秒、情绪延展 8–9 秒交替。
   运镜：禁止连续 ≥3 镜 camera 只写「固定机位」；须在推/拉/微手持/侧打/过肩/轻微跟移中轮换。
9. 每镜 timeOfDay 字段写本场时间（清晨/早上/白天/黄昏/夜），照抄剧本场景标题的时间；seedancePrompt 的光线必须与之一致，没有夜戏就不要写「夜戏/夜景/冷蓝夜色」。可选 location 短标签（如「别墅卧室」「老楼窗边」「教室」），同一物理场所跨镜保持同一标签，勿写成长句。
10. 场景必须「举证」设定事实，而非仅不矛盾：
   - 从用户【设定事实】抽出空间关系（对窗、邻居、别墅、旧楼、教室等），本场至少 1 镜 visual 写明该关系（例：甲家二楼窗与对面楼乙的窗形成对视轴线）。
   - 富裕居所 ≥2 个陈设锚点（落地窗纱/品牌灯具/整洁衣帽间/哑光地板等）；贫困居所 ≥2 个（旧窗框/磨损窗台/对面晾衣/墙皮斑驳等）。
   - 禁止空壳地点词单独成景： ban「宽敞明亮的卧室」「整齐的教室」「豪华别墅」而不写陈设。
   - 年龄只用角色卡 age；服装道具符合家境。
11. 表演落地：emotion 字段的标签必须翻译进 action 与 seedancePrompt（建议增加「表演：」子句）。禁止 action 仅写「…说话/喊话/回答/自语」。台词镜至少包含：开口前准备半拍、视线落点、说完余韵 三者之一。禁止把「僵住/凝固/愣住/面无表情」当作唯一表演，须改成具体微动态（指尖抽动、喉结滚动、眼神闪避后再强装对视等）。
12. 潜台词：若 dialogue 带「（冷笑/小声/心虚）」等，action 须写出与字面不一致的身体信号（口是心非）。
13. 服装描写不得出现 logo/校徽/胸标/刺绣标/字样等可能被画成文字的细节；visual/seedancePrompt 继续禁止可读屏幕字/招牌字/字幕（界面原文只放 overlayText）。
14. 起止状态（衔接用）：每镜 startState / endState 写画面内每个角色首帧与末帧的状态，键为角色名：{"pos":"left|right|center","facing":"left|right|front|away","pose":"站|坐|躺|跪|蹲|靠","gaze":"看向的角色名或 front","hands":"手持物或 空手"}。carryFromPrev=true 时本镜 startState 必须与上一镜 endState 完全相同；姿势/手持物只能在本镜时间轴里有动作交代时改变（如「起身」「拿起手机」）。有下一镜承接的镜头，时间轴最后约 1 秒只保持姿态，不加新动作。
15. 站位基准与机位：每场第一镜（establishing=true）给 blocking：{"positions":{"甲":"left","乙":"right"},"facing":{"甲":"right","乙":"left"},"door":"left|right|back|none","window":"left|right|back|none","holding":{"甲":"手机"}}，本场后续镜头不得让人物换边。每镜 cameraSide：master（全景/两人同框，交代轴线）| A（机位在轴线标准一侧：左边的人始终在画面左侧；正反打——一人单人近景接另一人单人近景——都属于 A）| B（机位真的越到轴线另一侧，两人在画面里左右对调，此时 startState 的 pos 也要写成对调后的左右；一般不用）；A 与 B 之间必须先经过一个 master 镜。eyeline：{"角色名":"left|right|front"}，左侧角色的单人近景视线朝画面右侧，右侧角色朝画面左侧。seedancePrompt 先写站位（谁在左谁在右、姿势、朝向），再写动作。
16. 一场戏一套光：每场第一镜给 lighting：{"key":"主光方向，如 左侧窗光/顶部灯光","soft":true,"temp":"暖|冷|中性"}，同场所有镜头的光线描写与之一致，不得同场忽冷忽暖、换光源方向。
17. 台词三类 voiceMode：onscreen（当面说，嘴型可见）| inner（内心独白，dialogue 写「名字（内心）：…」）| offscreen（画外音/电话里，放 voiceOnly）；inner 与 offscreen 的镜头里画面人物一律嘴唇闭合，seedancePrompt 不写开口说话。无台词写 ""。
18. 场景层 realm：reality（现实）| dream（梦境）| memory（回忆/闪回），同一场所有镜头相同；梦境/回忆场景里角色用对应的造型变体（如「甲（梦中）」），切换现实与梦境时该镜 establishing=true、carryFromPrev=false。
seedancePrompt：站位→主体→动作（含微表演）→表演→镜头→环境陈设与光线→风格（照抄画风句）→限制；竖屏9:16；只用用户角色视觉锁定；剧情主动作唯一且可带微动作；>5秒加时间轴（前段微反应/后段主动作或对调）。禁止角色缺失时硬写女主/男主。不要markdown围栏。`
