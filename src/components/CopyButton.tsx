import { useState } from 'react'
import { copyText } from '../lib/storage'

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className="btn-outline !px-2 !py-1 text-xs"
      onClick={async () => {
        const r = await copyText(text)
        setOk(r)
        window.setTimeout(() => setOk(false), 1500)
      }}
    >
      {ok ? '已复制' : label}
    </button>
  )
}
