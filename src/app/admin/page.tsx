import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Building2, ArrowRight } from 'lucide-react'

import { getSession, listUserTenants } from '@/core/session'

export const dynamic = 'force-dynamic'

/**
 * Aiguillage après connexion.
 *
 * Cette page ne montrait auparavant qu'un catalogue des 11 modules du
 * système — alors que c'est ici que la connexion renvoie. Un utilisateur
 * agency atterrissait donc sur une page qui ne lui appartenait pas et qui
 * n'avait aucun rapport avec son site.
 *
 * Elle ne rend plus rien de figé : elle répond « où doit aller cet
 * utilisateur ? ».
 *   — pas de session        → connexion
 *   — superadmin            → console transverse
 *   — un seul site          → ce site
 *   — plusieurs sites       → un choix explicite
 *   — aucun site            → écran d'attente, pas une impasse
 */
export default async function AdminHome() {
  const session = await getSession()
  if (!session?.user) redirect('/connexion')

  const user = session.user as { id: string; email?: string; isSuperAdmin?: boolean }
  if (user.isSuperAdmin) redirect('/superadmin')

  const sites = await listUserTenants(user.id)

  if (sites.length === 0) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <span
          className="mx-auto mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: 'var(--inset)', color: 'var(--muted)' }}
          aria-hidden
        >
          <Building2 size={20} strokeWidth={1.6} />
        </span>
        <h1 className="page-title">Aucun site ne vous est attribué</h1>
        <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
          Votre compte <span style={{ color: 'var(--ink)' }}>{user.email}</span> est actif
          mais n'est encore rattaché à aucun site. L&apos; agence doit vous ajouter à
          un site depuis la console d&apos;administration.
        </p>
        <Link href="/connexion" className="btn-ghost mt-8 inline-flex">Se déconnecter</Link>
      </main>
    )
  }

  if (sites.length === 1) redirect(`/admin/${sites[0].slug}`)

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="label" style={{ color: 'var(--muted)' }}>Vos sites</p>
      <h1 className="page-title mt-2">Lequel adminissez-vous ?</h1>

      <ul className="mt-8 flex flex-col gap-3">
        {sites.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/admin/${s.slug}`}
              className="card group flex items-center gap-4 p-5 transition-colors hover:bg-[var(--inset)]"
            >
              <span
                className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ background: 'var(--ink)' }}
                aria-hidden
              >
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {s.name}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                  {s.modules.length} module{s.modules.length > 1 ? 's' : ''} actif
                  {s.modules.length > 1 ? 's' : ''} · rôle {s.role}
                </p>
              </div>
              <ArrowRight size={16} className="flex-shrink-0"
                style={{ color: 'var(--muted)' }} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}