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
