import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'vijay.suresh11@gmail.com'
const MAX_ATTEMPTS = 3

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: analysis } = await supabase
    .from('analyses')
    .select('id, video_path, attempt_count')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!analysis?.video_path) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = user.email === ADMIN_EMAIL
  const attemptCount = analysis.attempt_count ?? 0

  if (!isAdmin && attemptCount >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'MAX_ATTEMPTS_REACHED' }, { status: 429 })
  }

  // Increment attempt count and reset to pending before triggering
  await supabase
    .from('analyses')
    .update({ status: 'pending', attempt_count: attemptCount + 1, error_message: null })
    .eq('id', id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: downloadData, error: urlError } = await admin.storage
    .from('videos')
    .createSignedUrl(analysis.video_path, 3600)

  if (urlError || !downloadData) {
    return NextResponse.json({ error: 'Could not create download URL' }, { status: 500 })
  }

  const webhookUrl = process.env.MODAL_WEBHOOK_URL
  if (!webhookUrl) {
    return NextResponse.json({ error: 'MODAL_WEBHOOK_URL not configured' }, { status: 503 })
  }

  const modalRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_id: id, video_url: downloadData.signedUrl }),
  })

  if (!modalRes.ok) {
    const text = await modalRes.text()
    return NextResponse.json({ error: `Modal error: ${text}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
