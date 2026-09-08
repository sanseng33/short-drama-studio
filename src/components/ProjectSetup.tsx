import type { ProjectApi } from '../hooks/useProject'
import type { ArtStyle, Genre, Platform } from '../types'

const GENRES: Genre[] = ['男频玄幻', '都市逆袭', '古风女频重生', '大女主']
const PLATFORMS: Platform[] = ['红果', '抖音试水', '海外ReelShort']
const STYLES: ArtStyle[] = ['2D国风', '2D日漫']

export function ProjectSetup({ api }: { api: ProjectApi }) {
  const { project, update, applyGenreDefaults } = api
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">项目设定</h2>
        <p className="mt-1 text-sm text-ink-muted">
          选定题材与平台后，可用「按题材填充」一键生成角色卡与 logline。优先 2D 漫剧，题材公式：压抑 → 开挂 → 打脸。
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
          placeholder="被退婚的废柴少年觉醒上古神魂，一路打脸……"
        />
      </div>

      <button type="button" className="btn-primary" onClick={applyGenreDefaults}>
        按题材填充角色与 Logline
      </button>
    </div>
  )
}
