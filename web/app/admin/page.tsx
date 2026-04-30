import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'vijay.suresh11@gmail.com'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== ADMIN_EMAIL) redirect('/dashboard')

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: { users: authUsers } }, { data: analyses }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('analyses').select('user_id, status, created_at, attempt_count'),
  ])

  const statsByUser = (analyses ?? []).reduce(
    (acc, a) => {
      if (!acc[a.user_id]) acc[a.user_id] = { total: 0, complete: 0, error: 0, pending: 0 }
      acc[a.user_id].total++
      if (a.status === 'complete') acc[a.user_id].complete++
      else if (a.status === 'error') acc[a.user_id].error++
      else acc[a.user_id].pending++
      return acc
    },
    {} as Record<string, { total: number; complete: number; error: number; pending: number }>
  )

  const totalAnalyses = analyses?.length ?? 0
  const totalComplete = (analyses ?? []).filter(a => a.status === 'complete').length

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Dashboard
          </Link>
          <span className="text-gray-600">/</span>
          <span className="font-semibold">Admin</span>
        </div>
        <span className="text-sm text-gray-400">{user.email}</span>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Users</p>
            <p className="text-3xl font-bold">{authUsers.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Reewinds</p>
            <p className="text-3xl font-bold">
              {totalAnalyses}
              <span className="text-lg text-gray-500 ml-1">/ 300</span>
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Completed</p>
            <p className="text-3xl font-bold text-green-400">{totalComplete}</p>
          </div>
        </div>

        {/* Users table */}
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">Users</h2>
        <p className="text-xs text-gray-600 mb-4">
          Passwords are hashed by Supabase and are never accessible — only email and activity are shown.
        </p>

        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <div className="hidden sm:grid sm:grid-cols-[1fr_110px_60px_60px_60px] gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
            <span>Email</span>
            <span className="text-right">Joined</span>
            <span className="text-right">Total</span>
            <span className="text-right">Done</span>
            <span className="text-right">Errors</span>
          </div>

          <ul className="divide-y divide-gray-800/60">
            {authUsers
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((u) => {
                const stats = statsByUser[u.id] ?? { total: 0, complete: 0, error: 0, pending: 0 }
                const isThisAdmin = u.email === ADMIN_EMAIL
                return (
                  <li
                    key={u.id}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_110px_60px_60px_60px] gap-1 sm:gap-3 items-start sm:items-center px-4 py-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-white truncate" title={u.email ?? ''}>
                        {u.email}
                      </span>
                      {isThisAdmin && (
                        <span className="flex-none text-xs text-indigo-300 bg-indigo-950 border border-indigo-800 px-1.5 py-0.5 rounded">
                          admin
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 sm:text-right whitespace-nowrap">
                      {new Date(u.created_at).toLocaleDateString()}
                    </span>
                    <span className="text-xs text-gray-300 sm:text-right">{stats.total}</span>
                    <span className="text-xs text-green-400 sm:text-right">{stats.complete}</span>
                    <span className="text-xs text-red-400 sm:text-right">{stats.error}</span>
                  </li>
                )
              })}
          </ul>
        </div>
      </main>
    </div>
  )
}
