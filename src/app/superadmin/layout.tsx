import { redirect } from 'next/navigation'
import { requireSuperAdmin } from '@/core/session'

export const dynamic = 'force-dynamic'

/**
 * Console superadmin — accès TRANSVERSE, réservé à l'agence.
 *
 * Garde au niveau du layout : aucune page enfant n'est atteignable sans
 * passer par ici. Le contrôle est refait dans chaque action mutante — un garde
 * de rendu ne protège pas d'un appel direct à une Server Action.
 *
 * La vérification ne résout aucun tenant : elle porte sur la session et sur
 * l'indicateur superadmin, rien d'autre.
 */
export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireSuperAdmin()

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