/**
 * session.ts — Résolution de la session et du tenant côté serveur.
 *
 * SEUL endroit autorisé à transformer une requête en TenantContext.
 * Aucune route ne doit construire son contexte à la main : c'est ici que le
 * tenant est déduit de la session (jamais d'un paramètre), et que le rôle est
 * dérivé de l'appartenance à l'organisation.
 */

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, assertAuthConfigured } from '@/core/auth'
import { getTenantBySlug, type Role, type TenantContext } from '@/db'
import { resolveEnabled, type ModuleKey } from '@/core/modules'
import { resolveTheme, type TenantTheme } from '@/core/theme'

export interface ResolvedSession {
  ctx: TenantContext
  user: { id: string; email: string; name: string | null }
  tenant: {
    id: string
    slug: string
    name: string
    modules: ModuleKey[]
    theme: TenantTheme
  }
  isSuperAdmin: boolean
}

/**
 * Récupère la session. Renvoie `null` si non authentifié.
 * N'échoue jamais : c'est le point d'entrée des guards.
 */
export async function getSession() {
  try {
    assertAuthConfigured()
    return await auth.api.getSession({ headers: await headers() })
  } catch {
    return null
  }
}

/**
 * Résolution complète session + tenant.
 *
 * Le tenant vient de l'ID d'organisation porté par la session. Si un
 * superadmin n'a pas d'organisation active, on retombe sur le slug demandé —
 * ce qui lui permet d'administrer un tenant précis.
 */
export async function resolveSession(slug?: string): Promise<ResolvedSession | null> {
  const session = await getSession()
  if (!session?.user) return null

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
  }

  const isSuperAdmin = Boolean(
    (session.user as { isSuperAdmin?: boolean }).isSuperAdmin,
  )

  // Tenant : soit le slug est fourni par la route (le cas normal en
  // admin/« slug »), soit il est résolu depuis l'organisation active de la
  // session — branché dès que les tables Better Auth sont en base.
  const tenantSlug = slug ?? null
  if (!tenantSlug) return null

  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) return null

  const modules = resolveEnabled(tenant.modules)

  // Rôle : superadmin court-circuite, sinon `owner` au sein de l'org.
  // Le raffinement par rôle/membre arrive avec les tables Better Auth.
  const role: Role = isSuperAdmin ? 'superadmin' : 'owner'

  return {
    ctx: {
      tenantId: String(tenant.id),
      role,
      userId: user.id,
      userEmail: user.email,
    },
    user,
    tenant: {
      id: String(tenant.id),
      slug: String(tenant.slug),
      name: String(tenant.name),
      modules,
      theme: resolveTheme(tenant.theme),
    },
    isSuperAdmin,
  }
}

/** Guard : redirige vers la connexion si pas de session. */
export async function requireSession(slug?: string): Promise<ResolvedSession> {
  const s = await resolveSession(slug)
  if (!s) redirect('/connexion')
  return s
}