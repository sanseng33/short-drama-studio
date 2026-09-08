import type { ProjectApi } from '../hooks/useProject'
import { DEFAULT_LLM } from '../types'

export function Settings({ api }: { api: ProjectApi }) {
  const { llm, setLlm } = api
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">设置 · 可选 LLM</h2>
        <p className="mt-1 text-sm text-ink-muted">
          完全按下方填写的 Base URL / API Key / Model 调用，兼容 OpenAI Chat Completions 协议。
          默认推荐 DeepSeek（按量充值，性价比高）。Key 仅存本机 localStorage。不填 Key 时仍可用「模板生成」。
        </p>
      </header>

      <div className="grid gap-4 max-w-xl">
        <div>
          <label className="label">Base URL</label>
          <input
            className="field"
            value={llm.baseURL}
            onChange={(e) => setLlm({ ...llm, baseURL: e.target.value })}
            placeholder="https://api.deepseek.com/v1"
          />
          <p className="mt-1 text-[11px] text-ink-faint">
            DeepSeek：<code>https://api.deepseek.com/v1</code>。也可填任意兼容网关。
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
            placeholder="deepseek-v4-flash"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary w-fit"
            onClick={() =>
              setLlm({
                baseURL: DEFAULT_LLM.baseURL,
                apiKey: llm.apiKey,
                model: DEFAULT_LLM.model,
              })
            }
          >
            填入 DeepSeek 默认
          </button>
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
            填入本机 LiteLLM（可选）
          </button>
        </div>
      </div>

      <div className="panel p-4 text-sm text-ink-muted leading-relaxed">
        <p className="font-medium text-ink">DeepSeek 怎么配</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            打开{' '}
            <a
              className="text-accent underline"
              href="https://platform.deepseek.com"
              target="_blank"
              rel="noreferrer"
            >
              platform.deepseek.com
            </a>{' '}
            注册/登录 → API Keys 创建密钥
          </li>
          <li>
            在 Billing / 充值里预充余额（按量扣费，不是订阅）；新账号有时有试用额度
          </li>
          <li>Base URL：<code>https://api.deepseek.com/v1</code></li>
          <li>
            Model：日常用 <code>deepseek-v4-flash</code>；更强可选{' '}
            <code>deepseek-v4-pro</code>
          </li>
        </ul>
        <p className="mt-3 font-medium text-ink">推荐组合</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>剧本 / 分镜拆解：DeepSeek Flash / Pro</li>
          <li>角色定妆 / 分镜宫格：GPT-Image 或本地 ComfyUI</li>
          <li>视频：Seedance 2.0 / 即梦；本地 16GB：ComfyUI + Wan2.x</li>
          <li>成片：剪映 + ffmpeg</li>
        </ul>
        <p className="mt-3 text-xs">完整流程见仓库根目录 GUIDE.md。</p>
      </div>
    </div>
  )
}
