'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

function validatePassword(pw: string): string {
  if (pw.length < 8)           return 'Password must be at least 8 characters.'
  if (!/[A-Z]/.test(pw))      return 'Password must contain at least one uppercase letter.'
  if (!/[0-9]/.test(pw))      return 'Password must contain at least one number.'
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must contain at least one special character.'
  return ''
}

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pwError, setPwError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  function onPasswordChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setPassword(val)
    if (val) setPwError(validatePassword(val))
    else setPwError('')
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    const pwMsg = validatePassword(password)
    if (pwMsg) { setPwError(pwMsg); return }

    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
          <p className="text-gray-400 text-sm">
            We sent a confirmation link to <span className="text-white">{email}</span>.
            Click it to activate your account.
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm text-indigo-400 hover:text-indigo-300">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  const requirements = [
    { label: '8+ characters',      met: password.length >= 8 },
    { label: 'Uppercase letter',   met: /[A-Z]/.test(password) },
    { label: 'Number',             met: /[0-9]/.test(password) },
    { label: 'Special character',  met: /[^A-Za-z0-9]/.test(password) },
  ]

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white tracking-tight">Reewind</h1>
          <p className="mt-1 text-sm text-gray-400">Create your account</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={onPasswordChange}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="Create a strong password"
            />

            {/* Live requirements checklist */}
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

            {pwError && !password.length && (
              <p className="mt-1.5 text-xs text-red-400">{pwError}</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Already have an account?{' '}
          <Link href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
