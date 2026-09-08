import type { ProjectApi } from '../hooks/useProject'
import { projectToMarkdown, seedancePack } from '../lib/export'
import { downloadText } from '../lib/storage'
import { CopyButton } from './CopyButton'

export function ExportPanel({ api }: { api: ProjectApi }) {
  const { project, flash } = api
  const md = projectToMarkdown(project)
  const pack = seedancePack(project, project.selectedEpisode)
  const packAll = seedancePack(project)

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">导出</h2>
        <p className="mt-1 text-sm text-ink-muted">
          下载 Markdown 项目手册、完整 JSON、以及可直接粘贴到 Seedance / 即梦的提示词包。
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            downloadText(`${project.title || 'project'}.md`, md, 'text/markdown')
            flash('已下载 Markdown')
          }}
        >
          下载 Markdown
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            downloadText(
              `${project.title || 'project'}.json`,
              JSON.stringify(project, null, 2),
              'application/json',
            )
            flash('已下载 JSON')
          }}
        >
          下载 JSON
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={() => {
            downloadText(
              `${project.title || 'project'}-seedance-ep${project.selectedEpisode}.txt`,
              pack,
            )
            flash('已下载本集 Seedance 包')
          }}
        >
          本集 Seedance 包
        </button>
      </div>

      <button
        type="button"
        className="btn-outline"
        onClick={() => {
          downloadText(`${project.title || 'project'}-seedance-all.txt`, packAll)
          flash('已下载全部 Seedance 包')
        }}
      >
        下载全部已生成分镜的 Seedance 包
      </button>

      <div className="panel p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">本集提示词预览</h3>
          <CopyButton text={pack} label="复制本集包" />
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-muted">
          {pack || '（本集尚无分镜）'}
        </pre>
      </div>
    </div>
  )
}
