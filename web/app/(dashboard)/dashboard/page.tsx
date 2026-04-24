import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import UploadWidget from './UploadWidget'

const STATUS_LABEL: Record<string, string> = {
  pending:           'Pending',
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

  const { data: analyses } = await supabase
    .from('analyses')
    .select('id, video_filename, status, created_at, duration_s')
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold tracking-tight">Rewind</span>
        <span className="text-sm text-gray-400">{user.email}</span>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h2 className="text-xl font-semibold mb-6">Upload a recording</h2>
        <UploadWidget />

        {analyses && analyses.length > 0 && (
          <section className="mt-12">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
              Recent analyses
            </h3>
            <ul className="space-y-2">
              {analyses.map((a) => (
                <li key={a.id}>
                  {a.status === 'complete' ? (
                    <Link
                      href={`/analyses/${a.id}`}
                      className="flex items-center justify-between px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-600 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{a.video_filename}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {new Date(a.created_at).toLocaleDateString()}
                          {a.duration_s ? ` · ${Math.round(a.duration_s / 60)} min` : ''}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </Link>
                  ) : (
                    <Link
                      href={`/analyses/${a.id}`}
                      className="flex items-center justify-between px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-600 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{a.video_filename}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {new Date(a.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[a.status] ?? 'text-gray-400 bg-gray-800'}`}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
