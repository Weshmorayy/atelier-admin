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
import { sql } from 'drizzle-orm'
import { auth, assertAuthConfigured } from '@/core/auth'
import { getDb, getTenantBySlug, type Role, type TenantContext } from '@/db'
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

  /* ── Appartenance : la seule barrière qui compte ──
   *
   * Résoudre un tenant par son slug ne dit RIEN de qui demande. Sans ce
   * contrôle, changer `continental` en `autre-client` dans l'URL suffirait à
   * ouvrir le back-office d'un autre client : le rôle était codé en dur
   * `owner` et le RLS, une fois positionné sur le bon tenant, ouvrait
   * toutes les portes.
   *
   * Le rôle vient donc de la ligne `member`, jamais d'une constante.
   */
  const memberRole = await getMemberRole(user.id, String(tenant.slug))
  const role = isSuperAdmin ? 'superadmin' : memberRole
  if (!role) return null

  const modules = resolveEnabled(tenant.modules)

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

/**
 * Traduit un rôle Better Auth vers l'échelle du RLS.
 *
 * `null` = refus. Un rôle inconnu ne doit JAMAIS être traité comme un rôle
 * par défaut : cela accorderait des droits par défaut à un compte mal
 * configuré.
 */
function toRole(raw: string | undefined | null): Role | null {
  switch (raw) {
    case 'owner':  return 'owner'
    case 'admin':  return 'manager'
    case 'editor': return 'editor'
    case 'viewer': return 'viewer'
    default:       return null
  }
}

/**
 * Rôle d'un utilisateur sur un tenant, via la table `member`.
 *
 * Les tables `member` et `organization` ne portent pas de RLS : ce sont des
 * tables d'identité, pas du contenu client. La jointure sur le slug est
 * exacte : un tenant existe si et seulement si une organisation porte le même
 * slug.
 */
async function getMemberRole(userId: string, tenantSlug: string): Promise<Role | null> {
  const rows = (await getDb().execute(sql`
    SELECT m.role
      FROM member m
      JOIN organization o ON o.id = m.organization_id
     WHERE m.user_id = ${userId}
       AND o.slug = ${tenantSlug}
     LIMIT 1
  `)) as unknown as { role: string }[]

  return toRole(rows[0]?.role)
}

/**
 * Tous les sites auxquels un utilisateur appartient réellement.
 *
 * Sert à l'aiguillage après connexion : un utilisateur agency doit atterrir
 * sur LE site qu'il administre, pas sur une page quiliste le système entier.
 *
 * `app_resolve_tenant` est croisé en LATERAL : il filtre les organisations
 * orphelines (organisation sans tenant, ou tenant désactivé) au lieu de
 * lister des sites inaccessible.
 */
export async function listUserTenants(userId: string): Promise<{
  slug: string; name: string; role: Role; modules: ModuleKey[]
}[]> {
  const rows = (await getDb().execute(sql`
    SELECT o.slug AS slug, t.name AS name, t.modules AS modules, m.role AS member_role
      FROM member m
      JOIN organization o ON o.id = m.organization_id
      CROSS JOIN LATERAL app_resolve_tenant(o.slug) t
     WHERE m.user_id = ${userId}
     ORDER BY o.slug
  `)) as unknown as {
    slug: string; name: string; modules: unknown; member_role: string
  }[]

  return rows.flatMap((r) => {
    const role = toRole(r.member_role)
    if (!role) return []
    return [{
      slug: r.slug,
      name: r.name,
      role,
      modules: resolveEnabled(r.modules),
    }]
  })
}

/**
 * Garde superadmin — SANS tenant.
 *
 * `resolveSession` exige un slug et une appartenance : c'est le bon modèle pour
 * administrer un site client, mais un superadmin n'appartient à aucun tenant
 * par construction. Il résolvait donc le sous-domaine (`localhost` en local),
 * obtenait un slug inexistant, et la console d'agence redirigeait vers la
 * connexion — forever.
 *
 * Ici la seule question posée est « qui êtes-vous et êtes-vous de l'agence ? ».
 * Le slug n'intervient pas, donc aucune résolution de tenant à échouer.
 */
export async function requireSuperAdmin(): Promise<{
  user: { id: string; email: string; name: string | null }
}> {
  const session = await getSession()
  if (!session?.user) redirect('/connexion')

  const isSuperAdmin = Boolean(
    (session.user as { isSuperAdmin?: boolean }).isSuperAdmin,
  )
  // Redirection et non 404 : on ne confirme pas l'existence de la console.
  if (!isSuperAdmin) redirect('/')

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
    },
  }
}

/** Guard : redirige vers la connexion si pas de session. */
export async function requireSession(slug?: string): Promise<ResolvedSession> {
  const s = await resolveSession(slug)
  if (!s) redirect('/connexion')
  return s
}