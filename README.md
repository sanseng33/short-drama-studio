# Short Drama Studio（AI 漫剧 / 短剧工作室）

本地纯前端工具：面向 **AI 漫剧 / 短剧** 的剧本大纲、角色卡、分集剧本、工业分镜表与 Seedance 提示词生成。画风支持 2D国风、2D日漫、真人都市；都市逆袭/都市重生带独立模板。

- **独立仓库**：可单独安装与启动；设置页填写兼容 OpenAI 协议的 Base URL + Key。
- **离线可用**：内置「男频玄幻废柴逆袭」「女频重生嫡女复仇」等中文模板；无 API Key 也能出可用大纲 / 剧本 / 分镜 / 提示词。
- **默认 LLM 示例**：DeepSeek（`https://api.deepseek.com/v1` + `deepseek-v4-flash`）；也可改 DeepSeek / 本机 LiteLLM 等。
- **详细生产线**：请先读同目录 **[GUIDE.md](./GUIDE.md)**（选题 → 出片 → 投稿全流程）。

仓库：https://github.com/sanseng33/short-drama-studio

## 在线地址（GitHub Pages）

- **在线体验**：https://sanseng33.github.io/short-drama-studio/
- 由 GitHub Actions 在 `main` 推送后自动构建并部署静态站点。
- 线上默认 LLM 指向 DeepSeek（`https://api.deepseek.com/v1`）；在「设置」填写你的 API Key，或改成任意兼容 OpenAI 协议的网关。

## 快速开始

进入本目录后执行依赖安装，再启动开发服务器（见 package.json 的 scripts：dev / build / preview）。

默认开发端口：5179。


## 从想法一键生成（推荐入口）

侧栏第 1 项「从想法一键生成」：粘贴自由格式的剧本想法（硬上限 2000 字，实时计数），点「一键生成」：
1. LLM 输出严格 JSON（标题 / 题材 / 画风 / logline / 世界观 / 1–8 个角色 / 合理集数的大纲），自动去围栏、解析失败重试一次；
2. 写入项目设定、角色卡、大纲；
3. 逐集生成剧本、分镜与 Seedance 提示词（可选全部集 / 前 3 集 / 不生成；单集 LLM 失败自动模板兜底）。

步骤进度实时显示，可随时取消（已完成部分保留）；结果都可在后续各步继续手改。无 API Key 时走启发式抽取（人名/关键词）+ 模板，效果明显弱于 LLM。原手动流程不变。

## 灵活阵容（Flexible Cast）

- 角色不再锁死「男主+女主+反派」三角；可增删/复制（建议 ≤8，生成至少 1 人）。
- 角色可写自由「定位」，并可选 `tags`（如 `protagonist` / `antagonist` / `mentor` / `support` / `romantic`）供模板与 LLM 识别。
- 「应用题材预设（可再改）」只写入推荐画风、logline 与一套**可再编辑**的阵容预设；另有：经典三角、单主+对手、双主角、女主+导师+反派、空白单主角。
- 大纲 / 剧本节拍 / 分镜镜数随角色数量与时长变化；缺失的角色不会被强行补写成「女主」。
- 侧栏步骤可随时跳转；有 1 个角色即可生成。

## 怎么用

1. **项目设定**：标题、题材、平台（红果/抖音试水/海外ReelShort）、集数、每集秒数、画风、logline。
2. **角色卡**：自由增删角色与标签；可用题材/阵容预设一键填充，再改。
3. **大纲**：点「模板生成」得到最多 30 集钩子+悬念；有 Key 可用「用 LLM 生成」。
4. **分集剧本**：选择集数 → 模板或 LLM → 得到 3 秒钩子结构剧本。
5. **分镜表**：生成镜号/景别/时长/画面/动作/台词/运镜/情绪/Seedance 提示词；可一键复制。
6. **导出**：Markdown 项目手册、JSON 全量、Seedance 提示词包。

数据自动写入浏览器 localStorage。侧栏支持「新建项目」「加载示例」。

## 快速命令

    npm install
    npm run dev
    npm run build
    npm run preview

## 默认 LLM（DeepSeek）

| 项 | 默认 |
| --- | --- |
| Base URL | `https://api.deepseek.com/v1` |
| API Key | 空（仅存浏览器 localStorage） |
| Model | `deepseek-v4-flash` |

1. 打开 [platform.deepseek.com](https://platform.deepseek.com) 注册 → **API Keys** 创建密钥
2. 在 **Billing / 充值** 预充余额（按量扣费）；新账号可能有试用额度
3. 在应用「设置」粘贴 Key；可点「填入 DeepSeek 默认」
4. 无 Key 时继续用「模板生成」

也可改填 OpenAI / xAI，或本机 LiteLLM：开发时 Base URL 可用 `/litellm/v1`（Vite 代理到 `127.0.0.1:4000`）。

## 目录

含 GUIDE.md、README.md、package.json、vite 配置与 src/（components、hooks、lib/templates）

## 与 Pixel Workbench

可复制到 pixel_workbench_agent/ai-short-drama-studio。不修改其他 Workbench 应用。

## 免责

仅供学习创作；投稿请遵守平台规范与版权。

## 导出给视频流水线（video-pipeline@1）

分镜页 / 导出页的「导出给视频流水线」按钮下载 `<剧名>-video-pipeline.json`（构建函数：`src/lib/videoExport.ts` 的 `buildVideoPipelineExport`，纯函数）。覆盖所有已生成分镜的集，按集号、镜号排序：

```jsonc
{
  "schema": "short-drama-studio/video-pipeline@1",
  "project": { "id", "title", "style", "platform", "secondsPerEp" },
  "characters": [{ "id", "name", "baseName?", "role", "tags", "visualLock", "costume", "signatureProp" }],
  "shots": [{
    "episode": 1, "shotNo": 1, "id": "s1-1",
    "characterIds": ["c1"],          // 引用 characters[].id
    "prompt": "…",                   // seedancePrompt，缺失时为 visual+action
    "visual": "…", "action": "…", "durationSec": 3,
    "dialogue": "…",                 // 已去掉「名字：」前缀；无台词/无/— 为 ""
    "speaker": "c1",                 // 说话人 id；null = 旁白/无台词
    "speakerName": "林川",           // 字幕显示名（baseName 优先）
    "voiceOnly": [],                 // 画外音/内心说话人（OS/画外音/V.O./电话里/内心等；内心可与 characterIds 重叠）
    "sfx": ["砰"],                   // 音效
    "overlayText": ["任务：反击"],   // 系统 UI / 屏幕文字，后期叠加
    "camera": "推", "size": "远景", "emotion": "…",
    "refImage": null,                // ComfyUI input 下的文件名或绝对路径（LoadImage 不支持 URL）或 null
    "segment": { "index": 0, "total": 2, "parentId": "s1-3" } // 仅当原镜被拆为多段
  }],
  "warnings": [{ "episode": 1, "shotId": "s1-3-a", "code": "dialogue_too_long", "message": "…" }]
}
```

每个镜头的 `characterIds`：模板生成取该镜已解析的出场角色；LLM 生成要求每镜返回 `characters` 角色名并映射为 id；兜底（含旧项目）按画面/动作/台词中出现的角色名自动识别。分镜卡片可点选角色芯片手动修正。示例：`samples/video-pipeline.sample.json`（由 `npx tsx scripts/gen-video-sample.ts` 生成）。

**占位符过滤**：模板 / 想法兜底生成的占位文字（如「待补充外貌与气质」「待补充服装」「请描述主角外貌」「待定」「TODO」）不会进入导出：`prompt`、`visual`、`action` 与 `characters[].visualLock/costume/signatureProp` 中的占位内容被清除（仅为占位时导出空字符串），不会出现空的「（视觉锁定：）」片段。模板分镜生成本身也会跳过空/占位的视觉锁定（`src/lib/placeholder.ts`）。

**长镜头拆分**：`buildVideoPipelineExport(project, { maxShotSec = 10 })`。`durationSec > maxShotSec` 的镜头拆成 `ceil(d / maxShotSec)` 段，时长近似均分（每段 ≤ maxShotSec，总和不变），id 为 `<id>-a`、`<id>-b`…，并附 `segment: { index, total, parentId }`（index 从 0 开始）；`dialogue`/`speaker` 仅保留在第一段，`prompt`/`characterIds` 各段相同。未拆分的镜头没有 `segment` 字段。schema 版本不变（仍为 video-pipeline@1，`segment` 为可选新增字段）。模板分镜的时长现均摊到各镜（单镜目标 ≤10s），不再把剩余时长全部堆到最后一镜。

### 视频流水线规整（ComfyUI / H3 图生视频，单段 ≤10s）

导出时（纯函数，不改动项目数据）逐集处理，**每集总时长严格不变**，所有段 2–10s（时间以 **0.5s** 为单位量化分配/借时/拆分；导出 `durationSec` 均为 0.5 的倍数。若本集镜头总时长不是 0.5 的倍数——例如 `secondsPerEp` 非 0.5 倍数导致分镜合计带小数——余数加在该集最后一段，并产生 `duration_remainder` 警告）：

1. **台词语速** 4.5 字/秒（只计 CJK 与字母数字，忽略标点与说话人前缀）。台词所需时长超过镜头时长时，先从同集最近的无台词镜头借时（每镜保持 ≥2s，本镜 ≤maxShotSec），不够再从其他台词镜头的富余时长借；若所需时长 >10s，则在句末标点处拆成多段（每段 ≤2 句、≤10s），仍放不下记 `dialogue_too_long` 警告。
2. **最短 2s**：1s/1.5s 镜头从邻镜借时；若整集段数过多无法满足，则合并同源/无台词的相邻段。
3. **单说话人**：解析 `名字：` / `名字（情绪）：` / `名字(OS)：`，多说话人拆段。无前缀时若 characterIds ∪ voiceOnly 只有一个候选则取之；`旁白：` 为 null；其余 null 记 `speaker_unresolved` 警告。前缀同时匹配 `baseName`，存在造型变体时优先取本镜 characterIds 中的变体，其次本集最近出现的变体。
4. **dialogue/sfx**：`无`/`无台词`/`—` → ""；`音效：砰`、`【音效】砰`、`【音效：砰】`、`(SFX)砰` 从 dialogue/action/prompt 中移出到 `sfx`。
5. **characterIds** 仅画面内角色；OS/画外音/画外/V.O./电话里/广播 标记的说话人、或不在 characterIds 中的说话人、以及分镜 `voiceOnly` 字段进入 `voiceOnly`（并从 characterIds 移除）。**内心/心声/心想**：若该角色本就在 characterIds（在画面内），则保留在 characterIds，同时加入 `voiceOnly`；若不在画面内则仅进 `voiceOnly`。
6. **overlayText**：只收需要后期叠加的界面原文——UI 关键词（屏幕/弹窗/显示/消息/系统…）后的『』「」“”引号内容、`系统提示：/界面显示：/弹窗：/屏幕文字：` 后的文字、`系统：` 及系统角色（名字/角色/标签含「系统」，如「系统小转」）的台词。约束句（`限制：…`、不出现…、禁止…、避免…、无字幕无水印）与画面描述（如「眼睛是两个转盘」）一律不进 overlay（约束仍保留在 prompt），去重。系统角色台词：`dialogue=""`、`speaker/speakerName=null`，不进 voiceOnly；其画内状态按原 characterIds 保留。`prompt` 中的 UI 渲染描述被移除，间接线索「蓝光映在角色脸上，神情专注」**只**加在 overlayText 非空或确实移除了 UI 描述的段上。
7. **warnings 新增**：`multi_character_shot`（段内 characterIds ≥2，提示改单人/过肩/正反打）；`speaker_offlist`（info：`收银员：` 等不在角色表的前缀 → `speaker=null`、`speakerName="收银员"`，不再报 `speaker_unresolved`）。
8. **单动作**：action 含 随后/然后/接着/紧接着/同时 时拆成顺序段，prompt 中的动作文本替换为对应分段动作；时长改变的段会去掉原 `时间轴：…` 片段。
9. **角色**：导出 costume、signatureProp、可选 baseName；为空时产生 `character_missing_costume` / `character_missing_prop` 警告（episode 为 0）。

生成侧：分镜 LLM 提示词强制单动作、2–10s、≤4.5 字/秒、单说话人「名字：」前缀、独立 `sfx` / `overlayText` / `voiceOnly` 字段、只写 UI 的间接线索；想法抽取必填 costume/signatureProp，并把外观明显不同的阶段拆成 `白朴（变帅前）` / `白朴（变帅后）`（同 `baseName`）。Shot 新增可选 `sfx` / `overlayText` / `voiceOnly`，分镜卡片可编辑；角色卡可填本名 baseName。模板分镜会从无台词镜头借整秒以满足台词语速。

测试：`npx tsx scripts/test-video-export.ts`（长台词、多说话人、无台词、音效、OS、电话画外音、内心画内保留、系统视窗、随后、1s/1.5s 镜头、造型变体、>10s 台词拆分、durationSec 均为 0.5 倍数；约束/描述不进 overlay、引号 UI 保留、提示线索仅限 UI 段、系统角色台词仅 overlay、多人同框警告、龙套 speakerName；并从真实导出《每天变帅一点点》`scripts/fixtures/real-export-meitian.json` 重建项目回归：overlay 27 条、无约束文本）。生成侧提示词要求优先单人镜头（过肩/正反打代替双人同框，最多2人）、龙套写身份前缀。

### 设定事实 / 家境 / 年龄 / 定妆图（v7）

- 从想法一键生成会抽取 **settingFacts**（关键设定事实，项目设定页可逐行编辑）以及每个角色的 **age / background（家境·住处）**；它们以「设定事实，必须遵守，不得与之矛盾」硬约束注入大纲 / 剧本 / 分镜提示词。想法项目（`source: 'idea'`）不再把「都市逆袭」之类题材标签与「压抑-开挂-打脸」套路塞进提示词。
- 剧本每场标注「地点 · 时间」，分镜每镜带 `timeOfDay`，不默认夜戏；导出时剧情时间（如「早上七点」）与提示词夜景冲突会给 `time_conflict` 警告。
- 角色卡新增 **定妆图 refImage**（文件名/前缀，如 `bai_pu_plain`）与 **锁定外观**：设置了 refImage 或勾选锁定的角色，其视觉锁定/服装/道具在重新一键生成或应用题材预设时不会被覆盖。导出 `characters[].refImage`；`shots[].refImage` 只保留分镜自己的值，否则为 null（接收端按 characterIds 取角色定妆图）。
- 导出：间接 UI 线索「蓝光映在角色脸上，神情专注」只出现在有 overlayText、画面内有人物、且为屏幕/系统时刻的段落，已有的旧线索会被剥离；`白朴（变帅前）（小声）：` 这类变体名+情绪前缀正确解析；误放进 overlayText 的人物台词会移回 dialogue；角色定位里仅提到「系统」的主角不再被当作系统角色。
