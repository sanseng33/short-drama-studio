import { useState } from 'react'
import { useProject } from './hooks/useProject'
import { Sidebar } from './components/Sidebar'
import { Preview } from './components/Preview'
import { ProjectSetup } from './components/ProjectSetup'
import { Characters } from './components/Characters'
import { Outline } from './components/Outline'
import { ScriptPanel } from './components/ScriptPanel'
import { Storyboard } from './components/Storyboard'
import { ExportPanel } from './components/ExportPanel'
import { Settings } from './components/Settings'
import { IdeaPanel } from './components/IdeaPanel'

export default function App() {
  const api = useProject()
  const { step, setStep, project, toast, error, setError, busy, newProject, loadSample } = api
  // 小屏（< md）侧栏是抽屉；md 及以上常驻，navOpen 不起作用
  const [navOpen, setNavOpen] = useState(false)
  const closeNav = () => setNavOpen(false)

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950 text-ink">
      <Sidebar
        step={step}
        onStep={(s) => {
          setStep(s)
          closeNav()
        }}
        title={project.title}
        onNew={() => {
          newProject()
          closeNav()
        }}
        onSample={() => {
          loadSample()
          closeNav()
        }}
        open={navOpen}
      />
      {navOpen && (
        <button
          type="button"
          aria-label="关闭菜单"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={closeNav}
        />
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-surface-700 bg-surface-900/90 px-4 py-2 md:hidden">
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5"
            aria-label="打开菜单"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            onClick={() => setNavOpen((v) => !v)}
          >
            ☰ 菜单
          </button>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{project.title || '未命名'}</span>
        </div>
        {(toast || error || busy) && (
          <div className="pointer-events-none absolute right-4 top-14 z-20 flex max-w-[calc(100%-2rem)] flex-col gap-2 sm:max-w-sm md:top-4">
            {busy && (
              <div className="pointer-events-auto rounded-lg border border-accent/40 bg-surface-800 px-3 py-2 text-xs text-accent-soft shadow-lg">
                LLM 生成中…
              </div>
            )}
            {toast && (
              <div className="pointer-events-auto rounded-lg border border-emerald-500/30 bg-surface-800 px-3 py-2 text-xs text-emerald-300 shadow-lg">
                {toast}
              </div>
            )}
            {error && (
              <div className="pointer-events-auto rounded-lg border border-red-500/40 bg-surface-800 px-3 py-2 text-xs text-red-300 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <span>{error}</span>
                  <button type="button" className="text-ink-faint hover:text-ink" onClick={() => setError('')}>
                    ×
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto min-w-0 max-w-3xl px-4 py-6 md:px-6 md:py-8">
            {step === 'idea' && <IdeaPanel api={api} />}
            {step === 'project' && <ProjectSetup api={api} />}
            {step === 'characters' && <Characters api={api} />}
            {step === 'outline' && <Outline api={api} />}
            {step === 'script' && <ScriptPanel api={api} />}
            {step === 'storyboard' && <Storyboard api={api} />}
            {step === 'export' && <ExportPanel api={api} />}
            {step === 'settings' && <Settings api={api} />}
          </div>
        </div>
      </main>

      <Preview project={project} />
    </div>
  )
}
