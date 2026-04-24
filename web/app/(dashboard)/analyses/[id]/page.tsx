'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type Keyframe = {
  id: string
  timestamp_s: number
  image_path: string
  description: string
}

type Analysis = {
  id: string
  status: string
  video_filename: string
  duration_s: number | null
  summary: string | null
  error_message: string | null
  created_at: string
  keyframes: Keyframe[]
}

const STATUS_LABEL: Record<string, string> = {
  pending:           'Queued…',
  extracting_frames: 'Extracting keyframes…',
  transcribing:      'Transcribing audio…',
  analyzing_screens: 'Analyzing screens with AI…',
  synthesizing:      'Writing summary…',
  complete:          'Complete',
  error:             'Error',
}

const TERMINAL = new Set(['complete', 'error'])

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

function keyframeImageUrl(imagePath: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/keyframes/${imagePath}`
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

// Parse citation spans like [42s] and [screen@67s] from summary text
function renderSummaryWithCitations(
  summary: string,
  onCitationClick: (timestampS: number) => void
) {
  const parts = summary.split(/(\[(?:screen@)?\d+s\])/g)
  return parts.map((part, i) => {
    const match = part.match(/\[(?:screen@)?(\d+)s\]/)
    if (match) {
      const ts = parseInt(match[1])
      return (
        <button
          key={i}
          onClick={() => onCitationClick(ts)}
          className="inline text-indigo-400 hover:text-indigo-300 font-mono text-sm underline underline-offset-2 decoration-dotted"
        >
          {part}
        </button>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const stripRef = useRef<HTMLDivElement>(null)
  const frameRefs = useRef<Record<number, HTMLDivElement | null>>({})

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/analyses/${id}`)
        if (res.status === 404) { router.push('/dashboard'); return }
        if (!res.ok) return

        const data: Analysis = await res.json()
        if (!cancelled) {
          setAnalysis(data)
          setLoading(false)
          if (!TERMINAL.has(data.status)) {
            setTimeout(poll, 3000)
          }
        }
      } catch {
        if (!cancelled) setTimeout(poll, 5000)
      }
    }

    poll()
    return () => { cancelled = true }
  }, [id, router])

  function scrollToKeyframe(timestampS: number) {
    if (!analysis) return
    // Find the nearest keyframe at or before this timestamp
    const kfs = [...analysis.keyframes].sort((a, b) => a.timestamp_s - b.timestamp_s)
    const nearest = kfs.reduce((best, kf) =>
      kf.timestamp_s <= timestampS ? kf : best
    , kfs[0])
    if (!nearest) return
    const el = frameRefs.current[nearest.timestamp_s]
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  if (!analysis) return null

  const isProcessing = !TERMINAL.has(analysis.status)
  const tldr = analysis.summary?.split('\n').find(l => l.trim().length > 0) ?? ''

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm">← Dashboard</Link>
        <span className="text-gray-600">/</span>
        <span className="text-sm text-white truncate max-w-xs">{analysis.video_filename}</span>
        {analysis.duration_s && (
          <span className="text-xs text-gray-500">{Math.round(analysis.duration_s / 60)} min</span>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">

        {/* Processing state */}
        {isProcessing && (
          <div className="flex items-center gap-3 mb-8 px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-sm text-gray-300">{STATUS_LABEL[analysis.status] ?? analysis.status}</span>
          </div>
        )}

        {/* Error state */}
        {analysis.status === 'error' && (
          <div className="mb-8 px-4 py-3 bg-red-950 border border-red-800 rounded-lg text-sm text-red-300">
            Processing failed: {analysis.error_message ?? 'Unknown error'}
          </div>
        )}

        {/* TL;DR banner */}
        {tldr && (
          <div className="mb-8 px-5 py-4 bg-indigo-950 border border-indigo-800 rounded-xl">
            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-1">TL;DR</p>
            <p className="text-white text-sm leading-relaxed">{tldr}</p>
          </div>
        )}

        {/* Keyframe strip */}
        {analysis.keyframes.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Keyframes</h2>
            <div
              ref={stripRef}
              className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-gray-700"
            >
              {analysis.keyframes.map((kf) => (
                <div
                  key={kf.id}
                  ref={(el) => { frameRefs.current[kf.timestamp_s] = el }}
                  className="flex-none w-48 cursor-default"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={keyframeImageUrl(kf.image_path)}
                    alt={`Screen at ${formatTime(kf.timestamp_s)}`}
                    className="w-48 h-27 object-cover rounded-lg bg-gray-800"
                    loading="lazy"
                  />
                  <p className="mt-1.5 text-xs text-indigo-400 font-mono">{formatTime(kf.timestamp_s)}</p>
                  {kf.description && (
                    <p className="mt-0.5 text-xs text-gray-400 leading-relaxed line-clamp-2">{kf.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Full summary */}
        {analysis.summary && (
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Summary</h2>
            <div className="prose prose-invert prose-sm max-w-none">
              {analysis.summary.split('\n\n').map((para, i) => (
                <p key={i} className="text-gray-200 leading-relaxed mb-4">
                  {renderSummaryWithCitations(para, scrollToKeyframe)}
                </p>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
