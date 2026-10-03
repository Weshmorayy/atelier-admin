import Link from 'next/link'
import { headers } from 'next/headers'
import { resolveSession } from '@/core/session'
import { themeToCssVars } from '@/core/theme'
import Nav from '@/components/Nav'

export const dynamic = 'force-dynamic'

/**
 * Coquille de l'administration.
 *
 * Le thème du tenant est injecté dans <head> sous forme de variables CSS :
 * un seul jeu de composants, autant d'identités. C'est ce qui permet de
 * conserver tel quel l'apparence MG Perfume sans code dupliqué.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers()
  // Slug du tenant : sous-domaine du client, ou segment d'URL.
  const host = (hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '').split(':')[0]
  const subdomain = host.split('.')[0]

  const session = await resolveSession(subdomain)

  // Sans session : pas de coquille. Les pages enfant revérifient la session
  // avant de lire quoi que ce soit — aucune donnée ne fuit par l'absence de
  // session, simplement l'affichage n'est pas habillé.
  if (!session) return <>{children}</>

  const { tenant, user } = session

  return (
    <>
      {/* Les variables de thème s'appliquent globalement : une balise <style>
          dans le body suffit et évite de dupliquer <html>/<body>, déjà rendus
          par le layout racine. */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: themeToCssVars(tenant.theme) }} />

      <header className="hairline sticky top-0 z-30 bg-[var(--bg)]">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-3">
              <span
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white"
                style={{ background: 'var(--ink)' }}
                aria-hidden
              >
                {tenant.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <p className="text-sm font-semibold leading-tight text-[var(--ink)]">{tenant.name}</p>
                <p className="label" style={{ color: 'var(--muted)' }}>
                  {tenant.theme.tagline ?? 'Administration'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {session.isSuperAdmin ? (
                <span className="label rounded-full px-2.5 py-1" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                  Superadmin
                </span>
              ) : null}
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{user.email}</span>
              <Link
                href="/api/auth/sign-out"
                className="label rounded-full px-3 py-1.5"
                style={{ border: '1px solid var(--border)' }}
              >
                Sortir
              </Link>
            </div>
          </div>
        </header>

      <div className="mx-auto flex max-w-[1400px] gap-8 px-6 py-8">
        <aside className="w-60 flex-shrink-0">
          <Nav tenantSlug={tenant.slug} enabled={tenant.modules} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  )
}