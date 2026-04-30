'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ResubmitButton({ analysisId }: { analysisId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleResubmit() {
    setLoading(true)
    try {
      await fetch(`/api/analyses/${analysisId}/trigger`, { method: 'POST' })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleResubmit}
      disabled={loading}
      className="mt-0.5 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
    >
      {loading ? 'Resubmitting…' : 'Resubmit'}
    </button>
  )
}
