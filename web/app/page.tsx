import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="relative min-h-screen bg-gray-950 text-white overflow-hidden flex flex-col items-center justify-center px-4">

      {/* Mesh gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute top-1/4 -right-32 w-[500px] h-[500px] rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-blue-600/15 blur-3xl" />
      </div>

      {/* Dot grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Content */}
      <div className="relative z-10 text-center max-w-2xl">
        <div className="inline-flex items-center gap-2 mb-6 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium tracking-wide uppercase">
          Beta
        </div>

        <h1 className="text-6xl sm:text-7xl font-bold tracking-tight mb-4 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-transparent">
          Reewind
        </h1>

        <p className="text-2xl sm:text-3xl font-medium text-indigo-300 mb-5">
          See what was said.
        </p>

        <p className="text-gray-400 text-base sm:text-lg leading-relaxed mb-10 max-w-lg mx-auto">
          Upload a video call. Get screen captures, a full transcript, and a narrative summary that connects what was shown with what was said.
        </p>

        <div className="flex gap-3 justify-center flex-wrap">
          {user ? (
            <Link
              href="/dashboard"
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-500/20"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/signup"
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-500/20"
              >
                Get started free
              </Link>
              <Link
                href="/login"
                className="px-6 py-3 bg-white/10 hover:bg-white/15 border border-white/10 text-white text-sm font-semibold rounded-xl transition-colors backdrop-blur-sm"
              >
                Sign in
              </Link>
            </>
          )}
        </div>

        <p className="mt-8 text-xs text-gray-600">
          Supports MP4, MOV, WEBM · up to 90 min · 2 GB
        </p>
      </div>
    </div>
  )
}
