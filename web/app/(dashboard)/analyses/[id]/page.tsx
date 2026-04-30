'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

function stripMarkdown(text: string) {
  return text
    .replace(/^#+\s*/, '')
    .replace(/\*+([^*]+)\*+/g, '$1')
    .replace(/^(TL;?DR|TLDR)\s*:?\s*/i, '')
    .trim()
}

// Extract the TL;DR content from the summary
function extractTldr(summary: string): string {
  const lines = summary.split('\n')
  let afterHeading = false

  for (const line of lines) {
    const l = line.trim()
    if (!l) continue

    // Heading: ## TL;DR
    if (/^#+\s*(TL;?DR|TLDR)/i.test(l)) {
      afterHeading = true
      continue
    }

    // First content after heading
    if (afterHeading) {
      return stripMarkdown(l)
    }

    // Inline: **TL;DR**: content  or  TL;DR: content
    const inline = l.match(/^\**(?:TL;?DR|TLDR)\**\s*:?\s*\**\s*(.+)/i)
    if (inline) return stripMarkdown(inline[1])

    // Not a TL;DR line at all — stop looking
    break
  }
  return ''
}

// Build summary body with TL;DR section and horizontal rules removed
function buildSummaryBody(summary: string): string {
  const lines = summary.split('\n')
  const out: string[] = []
  let skipNextContent = false

  for (const line of lines) {
    const l = line.trim()

    if (l === '---') continue

    if (/^#+\s*(TL;?DR|TLDR)/i.test(l)) {
      skipNextContent = true
      continue
    }

    if (skipNextContent) {
      if (!l) continue               // blank lines after heading
      skipNextContent = false
      continue                       // the actual TL;DR paragraph — skip it
    }

    // Also strip inline TL;DR lines
    if (/^\**(?:TL;?DR|TLDR)\**\s*:/i.test(l)) continue

    out.push(line)
  }

  return out.join('\n').replace(/^\n+/, '').trimEnd()
}

// Protect citation spans [42s] / [screen@67s] from the markdown parser
function protectCitations(text: string) {
  return text.replace(/\[(screen@)?(\d+)s\]/g, (_, prefix, ts) =>
    `\`CITE:${prefix ? 'screen_' : ''}${ts}\``
  )
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)

  // Refs for keyframe strip scroll (citation → keyframe)
  const frameRefs = useRef<Record<number, HTMLDivElement | null>>({})
  // Refs for text scroll (keyframe → citation in text)
  const citationRefs = useRef<Map<number, HTMLElement>>(new Map())
  // Drag detection for keyframe strip
  const pointerDownX = useRef(0)

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
          if (!TERMINAL.has(data.status)) setTimeout(poll, 3000)
        }
      } catch {
        if (!cancelled) setTimeout(poll, 5000)
      }
    }

    poll()
    return () => { cancelled = true }
  }, [id, router])

  // Citation clicked → scroll to that keyframe in the strip
  function scrollToKeyframe(timestampS: number) {
    if (!analysis) return
    const kfs = [...analysis.keyframes].sort((a, b) => a.timestamp_s - b.timestamp_s)
    const nearest = kfs.reduce((best, kf) => kf.timestamp_s <= timestampS ? kf : best, kfs[0])
    if (!nearest) return
    frameRefs.current[nearest.timestamp_s]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  // Keyframe clicked → scroll to nearest citation in the text
  function scrollToTextSection(timestampS: number) {
    const entries = Array.from(citationRefs.current.entries())
    if (entries.length === 0) return
    const sorted = entries.sort(([a], [b]) => a - b)
    let best = sorted[0]
    for (const entry of sorted) {
      if (entry[0] <= timestampS) best = entry
      else break
    }
    best[1].scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const mdComponents = useMemo(() => ({
    p({ children }: { children?: React.ReactNode }) {
      return <p className="text-gray-200 leading-relaxed mb-4">{children}</p>
    },
    h1({ children }: { children?: React.ReactNode }) {
      return <h1 className="text-lg font-semibold text-white mt-6 mb-2">{children}</h1>
    },
    h2({ children }: { children?: React.ReactNode }) {
      return <h2 className="text-base font-semibold text-white mt-6 mb-2">{children}</h2>
    },
    h3({ children }: { children?: React.ReactNode }) {
      return <h3 className="text-sm font-semibold text-white mt-4 mb-1">{children}</h3>
    },
    strong({ children }: { children?: React.ReactNode }) {
      return <strong className="text-white font-semibold">{children}</strong>
    },
    em({ children }: { children?: React.ReactNode }) {
      return <em className="text-gray-300 italic">{children}</em>
    },
    ul({ children }: { children?: React.ReactNode }) {
      return <ul className="list-disc list-inside mb-4 space-y-1 text-gray-200">{children}</ul>
    },
    ol({ children }: { children?: React.ReactNode }) {
      return <ol className="list-decimal list-inside mb-4 space-y-1 text-gray-200">{children}</ol>
    },
    code({ children }: { children?: React.ReactNode }) {
      const text = String(children)
      const m = text.match(/^CITE:(screen_)?(\d+)$/)
      if (m) {
        const ts = parseInt(m[2])
        const label = m[1] ? `[screen@${ts}s]` : `[${ts}s]`
        return (
          <button
            ref={(el: HTMLButtonElement | null) => {
              if (el) citationRefs.current.set(ts, el)
              else citationRefs.current.delete(ts)
            }}
            onClick={() => scrollToKeyframe(ts)}
            className="inline text-indigo-400 hover:text-indigo-300 font-mono text-sm underline underline-offset-2 decoration-dotted"
          >
            {label}
          </button>
        )
      }
      return <code className="bg-gray-800 px-1 rounded text-sm">{children}</code>
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [analysis])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  if (!analysis) return null

  const isProcessing = !TERMINAL.has(analysis.status)

  const tldr = analysis.summary ? extractTldr(analysis.summary) : ''
  const summaryBody = analysis.summary ? buildSummaryBody(analysis.summary) : null

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm">← Dashboard</Link>
        <span className="text-gray-600">/</span>
        <span className="text-sm text-white truncate max-w-xs" title={analysis.video_filename}>
          {analysis.video_filename}
        </span>
        {analysis.duration_s && (
          <span className="text-xs text-gray-500">{Math.round(analysis.duration_s / 60)} min</span>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">

        {isProcessing && (
          <div className="flex items-center gap-3 mb-8 px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-sm text-gray-300">{STATUS_LABEL[analysis.status] ?? analysis.status}</span>
          </div>
        )}

        {analysis.status === 'error' && (
          <div className="mb-8 px-4 py-3 bg-red-950 border border-red-800 rounded-lg text-sm text-red-300">
            Processing failed: {analysis.error_message ?? 'Unknown error'}
          </div>
        )}

        {tldr && (
          <div className="mb-8 px-5 py-4 bg-indigo-950 border border-indigo-800 rounded-xl">
            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-1">TLDR</p>
            <p className="text-white text-sm leading-relaxed">{tldr}</p>
          </div>
        )}

        {analysis.keyframes.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Keyframes</h2>
            <div className="flex gap-3 overflow-x-auto pb-3">
              {analysis.keyframes.map((kf) => (
                <div
                  key={kf.id}
                  ref={(el) => { frameRefs.current[kf.timestamp_s] = el }}
                  onPointerDown={(e) => { pointerDownX.current = e.clientX }}
                  onClick={(e) => {
                    if (Math.abs(e.clientX - pointerDownX.current) > 5) return
                    scrollToTextSection(kf.timestamp_s)
                  }}
                  className="flex-none w-52 cursor-pointer group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={keyframeImageUrl(kf.image_path)}
                    alt={`Screen at ${formatTime(kf.timestamp_s)}`}
                    className="w-52 h-[117px] object-cover rounded-lg bg-gray-800 group-hover:ring-2 group-hover:ring-indigo-500 transition-all"
                    loading="lazy"
                  />
                  <p className="mt-1.5 text-xs text-indigo-400 font-mono">{formatTime(kf.timestamp_s)}</p>
                  {kf.description && (
                    <p className="mt-0.5 text-xs text-gray-400 leading-relaxed">{kf.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {summaryBody && (
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Summary</h2>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {protectCitations(summaryBody)}
            </ReactMarkdown>
          </div>
        )}

      </main>
    </div>
  )
}
