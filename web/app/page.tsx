import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="relative min-h-screen bg-gray-950 text-white overflow-hidden flex flex-col items-center justify-center px-4 py-16">

      {/* Mesh gradient orbs */}
      <div
        aria-hidden
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
      >
        <div style={{
          position: 'absolute', top: '-160px', left: '-160px',
          width: '600px', height: '600px', borderRadius: '9999px',
          background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', top: '25%', right: '-128px',
          width: '500px', height: '500px', borderRadius: '9999px',
          background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '0', left: '33%',
          width: '500px', height: '500px', borderRadius: '9999px',
          background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
        }} />
      </div>

      {/* Dot grid */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.12,
          backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 10, textAlign: 'center', maxWidth: '640px', width: '100%' }}>

        {/* Beta badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          marginBottom: '24px', padding: '4px 12px', borderRadius: '9999px',
          border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.1)',
          color: '#a5b4fc', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          Beta
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: 'clamp(48px, 8vw, 72px)', fontWeight: 700, letterSpacing: '-0.03em',
          marginBottom: '12px', lineHeight: 1.1,
          background: 'linear-gradient(180deg, #ffffff 0%, #9ca3af 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Reewind
        </h1>

        {/* Tagline */}
        <p style={{ fontSize: '22px', fontWeight: 500, color: '#818cf8', marginBottom: '40px' }}>
          See what was said.
        </p>

        {/* Steps */}
        <div style={{ textAlign: 'left', marginBottom: '40px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{
            display: 'flex', gap: '16px', alignItems: 'flex-start',
            padding: '16px', borderRadius: '12px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{
              flexShrink: 0, width: '28px', height: '28px', borderRadius: '9999px',
              background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 700, color: '#fff',
            }}>1</div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#fff', marginBottom: '2px' }}>What you give</p>
              <p style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.5 }}>Upload a recording that has screenshare.</p>
            </div>
          </div>

          <div style={{
            display: 'flex', gap: '16px', alignItems: 'flex-start',
            padding: '16px', borderRadius: '12px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{
              flexShrink: 0, width: '28px', height: '28px', borderRadius: '9999px',
              background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 700, color: '#fff',
            }}>2</div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#fff', marginBottom: '2px' }}>What you get</p>
              <p style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.5 }}>
                Screen captures, a full transcript, and a narrative summary that gives you the full picture —
                connecting what was said and what was shown.
              </p>
            </div>
          </div>
        </div>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {user ? (
            <Link
              href="/dashboard"
              style={{
                padding: '12px 24px', background: '#4f46e5', color: '#fff',
                borderRadius: '10px', fontWeight: 600, fontSize: '14px',
                textDecoration: 'none', transition: 'background 0.15s',
              }}
            >
              Go to dashboard →
            </Link>
          ) : (
            <>
              <Link
                href="/signup"
                style={{
                  padding: '12px 24px', background: '#4f46e5', color: '#fff',
                  borderRadius: '10px', fontWeight: 600, fontSize: '14px', textDecoration: 'none',
                }}
              >
                Get started free
              </Link>
              <Link
                href="/login"
                style={{
                  padding: '12px 24px', background: 'rgba(255,255,255,0.08)', color: '#fff',
                  borderRadius: '10px', fontWeight: 600, fontSize: '14px', textDecoration: 'none',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                Sign in
              </Link>
            </>
          )}
        </div>

        <p style={{ marginTop: '24px', fontSize: '11px', color: '#374151' }}>
          Supports MP4, MOV, WEBM · up to 90 min · 2 GB
        </p>
      </div>
    </div>
  )
}
