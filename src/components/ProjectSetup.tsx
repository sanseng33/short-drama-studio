import type { ProjectApi } from '../hooks/useProject'
import type { ArtStyle, Genre, Platform, SettingFactItem } from '../types'
import { itemsFromFacts } from '../lib/consistency/factLocks'
import { canonicalizeLocations } from '../lib/assetAudit'
import { collectFindings } from '../lib/consistency/collect'
import { locationNamer } from '../lib/locationNorm'
import { ConsistencyFindings } from './ConsistencyFindings'

const GENRES: Genre[] = ['男频玄幻', '都市逆袭', '都市重生', '古风女频重生', '大女主']
const PLATFORMS: Platform[] = ['红果', '抖音试水', '海外ReelShort']
const STYLES: ArtStyle[] = ['2D国风', '2D日漫', '真人都市']

export function ProjectSetup({ api }: { api: ProjectApi }) {
  const { project, update, applyGenreDefaults, confirmFacts, ignoreFinding } = api
  const factItems: SettingFactItem[] =
    project.settingFactItems && project.settingFactItems.length
      ? project.settingFactItems
      : itemsFromFacts(project.settingFacts)
  const setFactItems = (settingFactItems: SettingFactItem[]) => update({ settingFactItems })
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">项目设定</h2>
        <p className="mt-1 text-sm text-ink-muted">
          题材只提供推荐画风、logline 与可选阵容预设，不会锁死「男主+女主+反派」。
          步骤可随时跳转；角色 ≥1 即可生成大纲/剧本/分镜。公式参考：压抑 → 开挂 → 打脸。
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">标题</label>
          <input
            className="field"
            value={project.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </div>
        <div>
          <label className="label">题材</label>
          <select
            className="field"
            value={project.genre}
            onChange={(e) => update({ genre: e.target.value as Genre })}
          >
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">平台</label>
          <select
            className="field"
            value={project.platform}
            onChange={(e) => update({ platform: e.target.value as Platform })}
          >
            {PLATFORMS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">画风</label>
          <select
            className="field"
            value={project.style}
            onChange={(e) => update({ style: e.target.value as ArtStyle })}
          >
            {STYLES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">集数（建议 30）</label>
          <input
            type="number"
            min={1}
            max={100}
            className="field"
            value={project.episodeCount}
            onChange={(e) => update({ episodeCount: Number(e.target.value) || 30 })}
          />
        </div>
        <div>
          <label className="label">每集秒数（60–90）</label>
          <input
            type="number"
            min={45}
            max={180}
            className="field"
            value={project.secondsPerEp}
            onChange={(e) => update({ secondsPerEp: Number(e.target.value) || 75 })}
          />
        </div>
      </div>

      <div>
        <label className="label">一句话故事（Logline）</label>
        <textarea
          className="field min-h-[88px]"
          value={project.logline}
          onChange={(e) => update({ logline: e.target.value })}
          placeholder="被撤职的落魄青年手握父亲密钥，逆袭商界打脸……"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">自定义题材标签（可选）</label>
          <input
            className="field"
            value={project.customGenre || ''}
            onChange={(e) => update({ customGenre: e.target.value })}
            placeholder="如：悬疑校园 / 末世求生（模板仍按上方题材走）"
          />
        </div>
        <div>
          <label className="label">世界观 / 背景设定（可选）</label>
          <textarea
            className="field min-h-[40px]"
            value={project.worldSetting || ''}
            onChange={(e) => update({ worldSetting: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <label className="label">设定事实（每行一条；作为硬约束注入大纲/剧本/分镜提示词）</label>
          {factItems.map((item, idx) => (
            <div key={item.id || idx} className="flex flex-wrap items-center gap-2">
              <input
                className="field min-w-0 flex-1 basis-full sm:basis-0"
                value={item.text}
                onChange={(e) => {
                  const settingFactItems = factItems.map((it, i) =>
                    i === idx ? { ...it, text: e.target.value } : it,
                  )
                  setFactItems(settingFactItems)
                }}
                placeholder="如：主角是富三代，家住高档小区"
              />
              <label className="flex items-center gap-1 text-xs text-ink-muted whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={!!item.locked}
                  onChange={(e) => {
                    const settingFactItems = factItems.map((it, i) =>
                      i === idx ? { ...it, locked: e.target.checked } : it,
                    )
                    setFactItems(settingFactItems)
                  }}
                />
                锁定
              </label>
              <button
                type="button"
                className="btn-ghost !py-1 text-xs"
                onClick={() => setFactItems(factItems.filter((_, i) => i !== idx))}
              >
                删除
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() =>
                setFactItems([
                  ...factItems,
                  { id: `sf-${factItems.length + 1}-${Date.now()}`, text: '', locked: false, source: 'manual' },
                ])
              }
            >
              增加一行
            </button>
            <button type="button" className="btn-outline text-xs" onClick={() => confirmFacts()}>
              确认事实
            </button>
            {project.factsConfirmedAt ? (
              <span className="text-xs text-ink-muted">已确认</span>
            ) : null}
          </div>
        </div>
      </div>

      <div>
        <label className="label">场景表（每行一个规范地名；编辑不会改写已有镜头）</label>
        <textarea
          className="field min-h-[72px]"
          value={(project.locations || []).join('\n')}
          onChange={(e) => update({ locations: e.target.value.split('\n') })}
          onBlur={() =>
            update({
              locations: canonicalizeLocations(project.locations || [], locationNamer(project.characters)),
            })
          }
          placeholder={'如：别墅客厅\n老楼窗边'}
        />
      </div>

      <ConsistencyFindings
        title="资产一致性"
        findings={collectFindings(project).filter(
          (f) => f.code === 'location_not_in_table' || f.code === 'character_look_not_in_shot' || f.code === 'stale_storyboard',
        )}
        emptyText="暂无资产检查提醒。"
        onIgnore={ignoreFinding}
      />

      <button type="button" className="btn-primary" onClick={applyGenreDefaults}>
        应用题材预设（可再改）
      </button>
      <p className="text-xs text-ink-muted">
        会写入推荐画风 + logline（若为空）+ 一套可再编辑的阵容预设；不会清空你后续手改的结构意图——不满意就去「角色卡」增删或换阵容预设。
      </p>
    </div>
  )
}
