# Short Drama Studio（AI 漫剧 / 短剧工作室）

本地纯前端工具：面向 **AI 漫剧 / 短剧** 的剧本大纲、角色卡、分集剧本、工业分镜表与 Seedance 提示词生成。

- **独立仓库**：可单独安装与启动；可选对接本机 LiteLLM（与 Pixel Workbench Agent 的代理约定兼容）。
- **离线可用**：内置「男频玄幻废柴逆袭」「女频重生嫡女复仇」等中文模板；无 API Key 也能出可用大纲 / 剧本 / 分镜 / 提示词。
- **可选 LLM**：设置页填写兼容 OpenAI 协议的 Base URL + Key，用于增强生成。
- **详细生产线**：请先读同目录 **[GUIDE.md](./GUIDE.md)**（选题 → 出片 → 投稿全流程）。

仓库：https://github.com/sanseng33/short-drama-studio

## 在线地址（GitHub Pages）

- **在线体验**：https://sanseng33.github.io/short-drama-studio/
- 由 GitHub Actions 在 `main` 推送后自动构建并部署静态站点。
- 线上默认 LLM Base URL 指向本机 `http://127.0.0.1:4000/v1`（需自行启动 LiteLLM）；也可在「设置」中改为任意兼容 OpenAI 协议的网关。

## 快速开始

进入本目录后执行依赖安装，再启动开发服务器（见 package.json 的 scripts：dev / build / preview）。

默认开发端口：5179。

## 怎么用

1. **项目设定**：标题、题材、平台（红果/抖音试水/海外ReelShort）、集数、每集秒数、画风、logline。
2. **角色卡**：3 名角色的视觉锁定 / 服装 / 道具（可按题材一键填充）。
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

## LiteLLM（与主项目一致）

本工具默认走 Pixel Workbench 本机 LiteLLM 代理，与 `apps/api` 相同：

| 项 | 值 |
| --- | --- |
| 开发 Base URL | `/litellm/v1`（Vite 代理到 `http://127.0.0.1:4000`） |
| 直连 Base URL | `http://127.0.0.1:4000/v1` |
| Model | `eureka-flash` |
| API Key | 与 `apps/api/.env` 的 `LITELLM_API_KEY` 相同 |

先按仓库根 README「LiteLLM / OpenAI」启动 `:4000`，再在本页「设置」填写 Key。

## 可选 LLM

| 项 | 默认 |
| --- | --- |
| Base URL | https://api.openai.com/v1 |
| API Key | 空（仅 localStorage） |
| Model | gpt-4o-mini |

可改 DeepSeek 等兼容网关。无 Key 用模板生成。

## 目录

含 GUIDE.md、README.md、package.json、vite 配置与 src/（components、hooks、lib/templates）

## 与 Pixel Workbench

可复制到 pixel_workbench_agent/ai-short-drama-studio。不修改其他 Workbench 应用。

## 免责

仅供学习创作；投稿请遵守平台规范与版权。
