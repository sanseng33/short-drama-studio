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
  "characters": [{ "id", "name", "role", "tags", "visualLock", "costume", "signatureProp" }],
  "shots": [{
    "episode": 1, "shotNo": 1, "id": "s1-1",
    "characterIds": ["c1"],          // 引用 characters[].id
    "prompt": "…",                   // seedancePrompt，缺失时为 visual+action
    "visual": "…", "action": "…", "durationSec": 3,
    "dialogue": "…", "speaker": "c1", // speaker 仅在台词形如「名字：…」可识别时出现
    "camera": "推", "size": "远景", "emotion": "…",
    "refImage": null                 // 参考图 URL/dataURL 或 null
  }]
}
```

每个镜头的 `characterIds`：模板生成取该镜已解析的出场角色；LLM 生成要求每镜返回 `characters` 角色名并映射为 id；兜底（含旧项目）按画面/动作/台词中出现的角色名自动识别。分镜卡片可点选角色芯片手动修正。示例：`samples/video-pipeline.sample.json`（由 `npx tsx scripts/gen-video-sample.ts` 生成）。
