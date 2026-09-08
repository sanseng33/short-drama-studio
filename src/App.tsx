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

export default function App() {
  const api = useProject()
  const { step, setStep, project, toast, error, setError, busy, newProject, loadSample } = api

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950 text-ink">
      <Sidebar
        step={step}
        onStep={setStep}
        title={project.title}
        onNew={newProject}
        onSample={loadSample}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {(toast || error || busy) && (
          <div className="pointer-events-none absolute right-4 top-4 z-20 flex max-w-sm flex-col gap-2">
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

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
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
