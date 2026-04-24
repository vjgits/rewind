import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold tracking-tight">Rewind</span>
        <span className="text-sm text-gray-400">{user.email}</span>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold mb-2">Upload a recording</h2>
        <p className="text-gray-400 text-sm">Upload flow coming next.</p>
      </main>
    </div>
  )
}
