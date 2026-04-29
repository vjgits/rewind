import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { filename } = await request.json()
  if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 })

  // Global cap — keeps costs bounded during open beta
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { count } = await admin
    .from('analyses')
    .select('*', { count: 'exact', head: true })
  if ((count ?? 0) >= 1000) {
    return NextResponse.json({ error: 'ANALYSIS_CAP_REACHED' }, { status: 429 })
  }

  const { data: analysis, error: insertError } = await supabase
    .from('analyses')
    .insert({ user_id: user.id, video_filename: filename })
    .select('id')
    .single()

  if (insertError || !analysis) {
    return NextResponse.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  const videoPath = `${user.id}/${analysis.id}/${filename}`

  const { data: uploadData, error: urlError } = await admin.storage
    .from('videos')
    .createSignedUploadUrl(videoPath)

  if (urlError || !uploadData) {
    return NextResponse.json({ error: urlError?.message ?? 'Could not create upload URL' }, { status: 500 })
  }

  await supabase
    .from('analyses')
    .update({ video_path: videoPath })
    .eq('id', analysis.id)

  return NextResponse.json({
    analysisId: analysis.id,
    uploadPath: videoPath,
    uploadToken: uploadData.token,
    signedUrl: uploadData.signedUrl,
  })
}
