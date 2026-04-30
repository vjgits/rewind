'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

function validatePassword(pw: string): string {
  if (pw.length < 8)               return 'Password must be at least 8 characters.'
  if (!/[A-Z]/.test(pw))          return 'Password must contain at least one uppercase letter.'
  if (!/[0-9]/.test(pw))          return 'Password must contain at least one number.'
  if (!/[^A-Za-z0-9]/.test(pw))  return 'Password must contain at least one special character.'
  return ''
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const requirements = [
    { label: '8+ characters',     met: password.length >= 8 },
    { label: 'Uppercase letter',  met: /[A-Z]/.test(password) },
    { label: 'Number',            met: /[0-9]/.test(password) },
    { label: 'Special character', met: /[^A-Za-z0-9]/.test(password) },
  ]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const msg = validatePassword(password)
    if (msg) { setError(msg); return }

    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white tracking-tight">Reewind</h1>
          <p className="mt-1 text-sm text-gray-400">Set a new password</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="Create a strong password"
            />

            {password.length > 0 && (
              <ul className="mt-2 space-y-1">
                {requirements.map(r => (
                  <li key={r.label} className="flex items-center gap-1.5 text-xs">
                    <span className={r.met ? 'text-green-400' : 'text-gray-500'}>
                      {r.met ? '✓' : '○'}
                    </span>
                    <span className={r.met ? 'text-green-400' : 'text-gray-500'}>{r.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || requirements.some(r => !r.met)}
            className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
