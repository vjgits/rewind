import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: analysis, error } = await supabase
    .from('analyses')
    .select('*, keyframes(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .order('timestamp_s', { referencedTable: 'keyframes', ascending: true })
    .single()

  if (error || !analysis) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(analysis)
}
