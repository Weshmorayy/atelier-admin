import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { resolveSession } from '@/core/session'

export const dynamic = 'force-dynamic'

/**
 * Console superadmin — accès TRANSVERSE, réservé à l'agence.
 *
 * Garde au niveau du layout : aucune page enfant n'est atteignable sans
 * passer par ici. Le contrôle est refait dans chaque action mutante — un garde
 * de rendu ne protège pas d'un appel direct à une Server Action.
 */
export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const host = (await headers()).get('x-forwarded-host') ?? ''
  const subdomain = host.split(':')[0]

  const session = await resolveSession(subdomain)

  // Pas de session → page de connexion. Pas de superadmin → 404.
  // Le 404 est volontaire : ne pas révéler l'existence d'une zone d'administration.
  if (!session) redirect('/connexion')
  if (!session.isSuperAdmin) redirect('/')

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <header className="flex items-center justify-between gap-4 pb-6">
        <div>
          <p className="label" style={{ color: 'var(--accent-text)' }}>Atelier</p>
          <h1 className="mt-1 text-2xl font-semibold">Console agence</h1>
        </div>
        <span className="label rounded-full px-3 py-1.5"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
          Superadmin
        </span>
      </header>
      {children}
    </div>
  )
}