import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function Home(): Promise<never> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const role = user.app_metadata?.['role'] as string | undefined

  if (role === 'admin') {
    redirect('/admin/chantiers')
  }
  if (role === 'conducteur') {
    redirect('/conducteur/chantiers')
  }

  redirect('/login')
}
