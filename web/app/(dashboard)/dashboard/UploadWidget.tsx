'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

type Stage = 'idle' | 'uploading' | 'triggering' | 'done' | 'error' | 'cap'

const ACCEPTED = '.mp4,.mov,.webm,.mkv'
const MAX_BYTES = 2 * 1024 * 1024 * 1024  // 2 GB
const MAX_DURATION_S = 90 * 60             // 90 min
const SUPPORTED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/mkv'])

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration) }
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read video metadata')) }
    video.src = url
  })
}

export default function UploadWidget() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)

  async function handleFile(file: File) {
    // Format check
    const ext = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
    const validType = SUPPORTED_TYPES.has(file.type) || ['mp4', 'mov', 'webm', 'mkv'].includes(ext)
    if (!validType) {
      setErrorMsg('Unsupported format. Please upload an MP4, MOV, WEBM, or MKV file.')
      setStage('error')
      return
    }

    // Size check
    if (file.size > MAX_BYTES) {
      setErrorMsg('File must be under 2 GB.')
      setStage('error')
      return
    }

    // Duration check (client-side fast rejection before upload)
    try {
      const duration = await getVideoDuration(file)
      if (duration > MAX_DURATION_S) {
        const mins = Math.round(duration / 60)
        setErrorMsg(`Video is ${mins} min — maximum supported length is 90 minutes.`)
        setStage('error')
        return
      }
    } catch {
      // Can't read metadata — allow through, pipeline will validate
    }

    setErrorMsg('')
    setStage('uploading')
    setProgress(0)

    try {
      // 1. Create analysis record + get signed upload URL
      const createRes = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      })
      const createJson = await createRes.json()

      if (createRes.status === 429 && createJson.error === 'ANALYSIS_CAP_REACHED') {
        setStage('cap')
        return
      }
      if (!createRes.ok) throw new Error(createJson.error ?? 'Failed to create analysis')

      const { analysisId, uploadPath, uploadToken } = createJson

      // 2. Upload directly to Supabase Storage via signed URL
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from('videos')
        .uploadToSignedUrl(uploadPath, uploadToken, file, {
          onUploadProgress: (e) => setProgress(Math.round((e.loaded / e.total) * 100)),
        })
      if (uploadError) throw new Error(uploadError.message)

      // 3. Trigger Modal pipeline
      setStage('triggering')
      const triggerRes = await fetch(`/api/analyses/${analysisId}/trigger`, { method: 'POST' })
      if (!triggerRes.ok) throw new Error((await triggerRes.json()).error)

      setStage('done')
      router.push(`/analyses/${analysisId}`)
      router.refresh()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed')
      setStage('error')
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  if (stage === 'cap') {
    return (
      <div className="border border-gray-700 rounded-xl px-8 py-12 text-center">
        <p className="text-white font-medium mb-2">Rewind is at capacity</p>
        <p className="text-gray-400 text-sm">
          We&apos;ve hit our analysis limit during the beta.{' '}
          <a
            href="mailto:vijay.suresh11@gmail.com?subject=Rewind waitlist"
            className="text-indigo-400 hover:text-indigo-300 underline"
          >
            Join the waitlist
          </a>{' '}
          to be notified when spots open up.
        </p>
      </div>
    )
  }

  const isActive = stage === 'uploading' || stage === 'triggering'

  return (
    <div>
      <div
        onClick={() => !isActive && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'border-2 border-dashed rounded-xl px-8 py-12 text-center transition-colors',
          isActive ? 'border-indigo-500 cursor-default' : 'cursor-pointer hover:border-indigo-500',
          dragging ? 'border-indigo-400 bg-indigo-950/30' : 'border-gray-700',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={onInputChange}
        />

        {(stage === 'idle' || stage === 'error') && (
          <>
            <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-white font-medium mb-1">Drop a recording here</p>
            <p className="text-gray-400 text-sm">MP4, MOV, WEBM · max 90 min · max 2 GB</p>
          </>
        )}

        {stage === 'uploading' && (
          <>
            <p className="text-white font-medium mb-3">Uploading… {progress}%</p>
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div
                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        )}

        {stage === 'triggering' && (
          <p className="text-white font-medium">Starting analysis…</p>
        )}

        {stage === 'done' && (
          <p className="text-green-400 font-medium">Done — redirecting…</p>
        )}
      </div>

      {errorMsg && (
        <p className="mt-3 text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">
          {errorMsg}
        </p>
      )}
    </div>
  )
}
