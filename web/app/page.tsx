import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <h1 className="text-4xl font-semibold tracking-tight mb-3">Reewind</h1>
        <p className="text-xl text-gray-400 mb-10">See what was said.</p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/signup"
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
