# 台词完整性夹具（PK-02）

期望由规则推导，未用实现回填。本目录只有纯 JSON 与本说明，不 import 任何实现代码。测试状态在 PK-03 交接时记录，夹具本身不写「已通过」。

规则依据：`/Users/chengshuo/short-drama-studio-planning/task-orchestration.md` 中 PK-03「规则说明」（规范化 N、解析 P、对齐 M、分类 C）。阈值（Dice 0.60 / 0.35、覆盖窗口 1–3 行、短 key 长度 4 / 2）为编排建议初值。

`AcceptedRisk.targetKey` 约定（C10）：`sha1Hex(\`${code}|${episode}|${lineKey}|${occurrence}\`)`，其中 `lineKey` 是 N2 比较键。F21 已按此手算写入。

既有文件 `scripts/fixtures/real-export-meitian.json` 与 `real-export-meitian2.json` 不属于本包，未被修改。

## 文件与规则对照

| 夹具 | 文件 | 主要规则 | 期望摘要 |
| --- | --- | --- | --- |
| F01 基线 | `f01-baseline.json` | M1、C3 | 6 句台词、分镜留 4 句；2 条 `dialogue_missing`（definite） |
| F02 重复台词 | `f02-repeat.json`（F02a/F02b） | M1 | 2 对 1、3 对 2 各缺靠后那一次，不是 0 |
| F03 分镜多出 | `f03-extra.json` | C6 | 1 条 `dialogue_extra`（info），0 条缺失 |
| F04 顺序打乱 | `f04-order.json` | M2 | 0 缺失，1 条 `dialogue_order_changed`（warning） |
| F05 跨镜拆句 | `f05-split.json` | M3 | 0 缺失，1 条 `dialogue_split`（info，列出镜号） |
| F06 同人合句 | `f06-merge-same.json` | M3 | 0 缺失，1 条 `dialogue_merged`（warning） |
| F07 跨说话人合句 | `f07-merge-cross.json` | M3、C7 | 内容覆盖不计缺失，`dialogue_merged` + `speaker_unresolved` |
| F08 多说话人合说 | `f08-multi-speaker.json`（F08a/F08b） | P7、C3 | 两人各说一次 0 缺失；只有小李说则小王那份 1 条 definite |
| F09 旁白/OS/内心 | `f09-narration.json`（F09a/F09b） | P3、N3 | 丢掉 OS 与内心为 definite 缺失；仅语气括号不同视为同句 |
| F10 场次标题与动作 | `f10-heading-action.json` | P1、P4 | 标题与动作不进清单；台词只在 visual 里仍记缺失 |
| F11 标题冒充对白 | `f11-title-as-dialogue.json` | P1、C6 | `dialogue_extra`（info）不能抵消缺失 |
| F12 只有标题与动作 | `f12-unparseable-script.json` | C8、C9 | `status: unparseable`，`dialogue_unparseable`，0 条 definite |
| F13 标点与空白 | `f13-punctuation.json` | N1、N2 | 视为同一句，无任何 finding |
| F14 标点掩盖缺词 | `f14-missing-char.json` | N5、C2 | 少一字 key 不同；Dice ≈ 0.40，待复核，不判通过 |
| F15 改写 | `f15-paraphrase.json` | M4、C1 | `dialogue_paraphrased`（warning），不计缺失 |
| F16 截断 | `f16-truncation.json` | C3 特例 | definite 缺失，evidence「仅保留前缀」 |
| F17 短句 | `f17-short.json`（F17a/F17b） | C3、C4、M5 | 「嗯。」恒待复核；「走吧。」无剩余 B 为 definite，有剩余 B 为待复核 |
| F18 歧义冒号 | `f18-ambiguous-colon.json` | P5、P6、C8 | 「时间：」忽略；过长说话人行 `dialogue_unparseable`，不计 definite |
| F19 分镜不可解析 | `f19-bad-shot-dialogue.json` | C8 | 非字符串 dialogue 不崩溃，该集 unparseable，不计 definite |
| F20 修复丢词 | `f20-dropped-silent.json` | C5 | 用 `shotsBefore` / `shots`；`dialogue_dropped_silent`（definite） |
| F21 已接受风险 | `f21-accepted-risk.json` | C10、G2 | 命中 F01 其中一句，该句 accepted，不再拦截；另一句仍 definite；不得改写 shots |
| F22 旧项目 | `f22-legacy.json` + `../legacy-projects/*.json` | C9、PK-01 迁移 | 无版本 / 无指纹 / 无剧本 / 只有 settingFacts / 有剧本无分镜：全部不崩溃 |
| F23 导出警告 | `f23-setting-fact-gap.json` | 导出 `setting_fact_gap` | 输入可触发 setting_fact_gap；**不写入** `voice_missing` 期望（留给后续，条件见 PK-04） |

必列夹具均已存在：F02、F04、F05、F06、F10、F12、F13、F14、F18、F22。
