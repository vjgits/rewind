import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import UploadWidget from './UploadWidget'
import LogoutButton from './LogoutButton'
import ResubmitButton from './ResubmitButton'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'vijay.suresh11@gmail.com'
const USER_CAP = 3

const STATUS_LABEL: Record<string, string> = {
  pending:           'Queued',
  extracting_frames: 'Extracting frames',
  transcribing:      'Transcribing',
  analyzing_screens: 'Analyzing screens',
  synthesizing:      'Synthesizing',
  complete:          'Complete',
  error:             'Error',
}

const STATUS_COLOR: Record<string, string> = {
  pending:           'text-gray-400 bg-gray-800',
  extracting_frames: 'text-blue-300 bg-blue-950',
  transcribing:      'text-blue-300 bg-blue-950',
  analyzing_screens: 'text-indigo-300 bg-indigo-950',
  synthesizing:      'text-purple-300 bg-purple-950',
  complete:          'text-green-300 bg-green-950',
  error:             'text-red-300 bg-red-950',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isAdmin = user.email === ADMIN_EMAIL

  const { data: analyses } = await supabase
    .from('analyses')
    .select('id, video_filename, status, created_at, duration_s')
    .order('created_at', { ascending: false })

  const count = analyses?.length ?? 0
  const canUpload = isAdmin || count < USER_CAP

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold tracking-tight">Reewind</span>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-sm text-gray-400">{user.email}</span>
          <LogoutButton />
          {isAdmin && (
            <Link href="/admin" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              Admin dashboard →
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">

        {/* How it works */}
        <section className="mb-10 space-y-3">
          <div className="flex gap-4 items-start p-4 bg-gray-900 border border-gray-800 rounded-xl">
            <div className="flex-none w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              1
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-0.5">What you give</p>
              <p className="text-sm text-gray-400">Upload a recording that has screenshare (MP4, MOV, WEBM · max 30 min · 500 MB).</p>
            </div>
          </div>
          <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
            <div className="flex gap-4 items-center mb-3">
              <div className="flex-none w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">
                2
              </div>
              <p className="text-sm font-semibold text-white">What you get</p>
            </div>
            <div className="flex flex-col gap-3 pl-11">
              <div className="flex gap-3 items-start">
                <span className="text-base shrink-0 mt-0.5">🖼️</span>
                <div>
                  <p className="text-xs font-semibold text-gray-200">Screen captures</p>
                  <p className="text-xs text-gray-500 leading-relaxed">Key moments extracted automatically from your recording.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-base shrink-0 mt-0.5">📝</span>
                <div>
                  <p className="text-xs font-semibold text-gray-200">Full transcript</p>
                  <p className="text-xs text-gray-500 leading-relaxed">Every word spoken, timestamped and searchable.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-base shrink-0 mt-0.5">✨</span>
                <div>
                  <p className="text-xs font-semibold text-gray-200">Narrative summary</p>
                  <p className="text-xs text-gray-500 leading-relaxed">Connects what was shown on screen with what was said — the full picture.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Upload section */}
        {canUpload ? (
          <>
            <h2 className="text-xl font-semibold mb-6">Upload a recording</h2>
            <UploadWidget />
          </>
        ) : (
          <div className="border border-gray-700 rounded-xl px-8 py-8 text-center mb-2">
            <p className="text-white font-medium mb-1">Sorry, limit exceeded</p>
            <p className="text-sm text-gray-400">
              You&apos;ve used all {USER_CAP} uploads.{' '}
              <a
                href="mailto:vijay.suresh11@gmail.com?subject=Reewind upload limit"
                className="text-indigo-400 hover:text-indigo-300 underline"
              >
                Contact us
              </a>{' '}
              to request more.
            </p>
          </div>
        )}

        {/* Recent Reewinds */}
        <section className="mt-12">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
            Recent Reewinds
          </h3>

          {count === 0 ? (
            <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl text-gray-600 text-sm">
              No recordings yet. Upload your first one above.
            </div>
          ) : (
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              {/* Column headers */}
              <div className="hidden sm:grid sm:grid-cols-[1fr_100px_70px_90px] gap-3 px-4 py-2 bg-gray-900/80 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                <span>Recording</span>
                <span className="text-right">Date</span>
                <span className="text-right">Length</span>
                <span className="text-right">Status</span>
              </div>

              <ul className="divide-y divide-gray-800/60">
                {analyses!.map((a) => {
                  const canResubmit = a.status === 'error' || a.status === 'pending'

                  return (
                    <li
                      key={a.id}
                      className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_100px_70px_90px] gap-3 items-start sm:items-center px-4 py-3 hover:bg-gray-900/40 transition-colors"
                    >
                      {/* Filename + resubmit */}
                      <div className="min-w-0">
                        <Link
                          href={`/analyses/${a.id}`}
                          className="text-sm font-medium text-white hover:text-indigo-300 transition-colors block truncate"
                          title={a.video_filename}
                        >
                          {a.video_filename}
                        </Link>
                        <p className="text-xs text-gray-500 sm:hidden mt-0.5">
                          {new Date(a.created_at).toLocaleDateString()}
                          {a.duration_s ? ` · ${Math.round(a.duration_s / 60)} min` : ''}
                        </p>
                        {canResubmit && <ResubmitButton analysisId={a.id} />}
                      </div>

                      {/* Date — desktop */}
                      <span className="hidden sm:block text-xs text-gray-500 text-right whitespace-nowrap">
                        {new Date(a.created_at).toLocaleDateString()}
                      </span>

                      {/* Duration — desktop */}
                      <span className="hidden sm:block text-xs text-gray-500 text-right">
                        {a.duration_s ? `${Math.round(a.duration_s / 60)} min` : '—'}
                      </span>

                      {/* Status badge */}
                      <div className="flex justify-end">
                        <span
                          className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_COLOR[a.status] ?? 'text-gray-400 bg-gray-800'}`}
                        >
                          {STATUS_LABEL[a.status] ?? a.status}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
