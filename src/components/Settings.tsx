import type { ProjectApi } from '../hooks/useProject'

export function Settings({ api }: { api: ProjectApi }) {
  const { llm, setLlm } = api
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">设置 · 可选 LLM</h2>
        <p className="mt-1 text-sm text-ink-muted">
          默认对接 Pixel Workbench 本机 LiteLLM（与 <code className="text-ink">apps/api</code> 的{' '}
          <code className="text-ink">LITELLM_PROXY_BASE_URL=http://127.0.0.1:4000</code> 一致）。
          Key 仅存本机 localStorage。不填 Key 时仍可用「模板生成」。
        </p>
      </header>

      <div className="grid gap-4 max-w-xl">
        <div>
          <label className="label">Base URL</label>
          <input
            className="field"
            value={llm.baseURL}
            onChange={(e) => setLlm({ ...llm, baseURL: e.target.value })}
            placeholder="/litellm/v1 或 http://127.0.0.1:4000/v1"
          />
          <p className="mt-1 text-[11px] text-ink-faint">
            开发默认 <code>/litellm/v1</code>（Vite 代理到 4000）。也可直连{' '}
            <code>http://127.0.0.1:4000/v1</code>（需代理开 CORS）。
          </p>
        </div>
        <div>
          <label className="label">API Key</label>
          <input
            className="field"
            type="password"
            value={llm.apiKey}
            onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
            placeholder="sk-..."
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label">Model</label>
          <input
            className="field"
            value={llm.model}
            onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            placeholder="eureka-flash"
          />
        </div>
        <button
          type="button"
          className="btn-secondary w-fit"
          onClick={() =>
            setLlm({
              baseURL: '/litellm/v1',
              apiKey: llm.apiKey,
              model: 'eureka-flash',
            })
          }
        >
          填入本机 LiteLLM 默认
        </button>
      </div>

      <div className="panel p-4 text-sm text-ink-muted leading-relaxed">
        <p className="font-medium text-ink">对接说明</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>先按根 README / apps/api README 启动 LiteLLM：<code>127.0.0.1:4000</code></li>
          <li>API Key 填与 <code>apps/api/.env</code> 中 <code>LITELLM_API_KEY</code> 相同的值</li>
          <li>模型默认 <code>eureka-flash</code>（与 API 一致）</li>
        </ul>
        <p className="mt-3 font-medium text-ink">推荐组合</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>剧本 / 分镜拆解：DeepSeek / Claude</li>
          <li>角色定妆 / 分镜宫格：GPT-Image 或本地 ComfyUI</li>
          <li>视频：Seedance 2.0 / 即梦；本地 16GB：ComfyUI + Wan2.x</li>
          <li>成片：剪映 + ffmpeg</li>
        </ul>
        <p className="mt-3 text-xs">完整流程见仓库根目录 GUIDE.md。</p>
      </div>
    </div>
  )
}
