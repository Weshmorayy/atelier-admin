/**
 * db/index.ts — Connexion Postgres et contexte tenant.
 *
 * Le point de passage OBLIGATOIRE vers la base. Toute requête doit être
 * encapsulée dans `withTenant()` : c'est cet appel qui positionne les variables
 * de session que les politiques RLS lisent.
 *
 * Le tenant vient TOUJOURS de la session utilisateur résolue côté serveur.
 * Jamais d'un paramètre de requête, d'un en-tête client, d'un body.
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'

export type Role = 'viewer' | 'editor' | 'manager' | 'owner' | 'superadmin'

export interface TenantContext {
  tenantId: string
  role: Role
  userId?: string
  userEmail?: string
}

let client: postgres.Sql | null = null
let db: PostgresJsDatabase<typeof schema> | null = null

function getClient() {
  if (!client) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL manquant')
    client = postgres(url, {
      max: 10,
      // Nécessaire pour que set_config(..., true) soit visible dans la transaction
      prepare: false,
    })
  }
  return client
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!db) db = drizzle(getClient(), { schema })
  return db
}

/**
 * Exécute `fn` dans une transaction où le tenant et le rôle sont positionnés.
 *
 * `set_config(..., true)` = scope transaction : le réglage disparaît au commit,
 * donc une connexion réutilisée par le pooler ne fuit jamais vers la requête
 * suivante. C'est une garantie de sécurité, pas une optimisation.
 *
 * On utilise la transaction Drizzle plutôt que `postgres.begin()` : le type du
 * `tx` reste compatible avec celui attendu par `fn`, sans transtypage.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId) throw new Error('withTenant: tenantId manquant')
  if (!ctx.role) throw new Error('withTenant: role manquant')

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${ctx.tenantId}, true)`)
    await tx.execute(sql`SELECT set_config('app.user_role', ${ctx.role}, true)`)
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`)
    await tx.execute(sql`SELECT set_config('app.user_email', ${ctx.userEmail ?? ''}, true)`)
    return fn(tx as unknown as PostgresJsDatabase<typeof schema>)
  })
}

/**
 * Contexte superadmin — vue transverse, SANS tenant courant.
 *
 * `app_is_superadmin()` se contente de lire `app.user_role`. Tant que ce
 * GUC n'est pas positionné, les politiques s'appliquent normalement et la
 * console d'afficher « 0 site » : la lecture est filtrée, silencieusement,
 * sans erreur. C'est le mode de défaillance que cette fonction corrige.
 *
 * ⚠ CECI N'EST PAS UN GARDE.
 *   `asSuperAdmin` pose un contexte ; il ne vérifie rien. L'appelant DOIT
 *   avoir déjà validé la session et l'indicateur superadmin
 *   (`requireSuperAdmin` dans core/session.ts). Sans cette discipline, la
 *   fonction devient un contournement : c'est pour cela qu'elle vit ici,
 *   dans la couche base, où le rappel est impossible à manquer.
 */
export async function asSuperAdmin<T>(
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    // `app.current_tenant` est vidé explicitement : un reste de contexte
    // dans la session PG ne doit pas pouvoir restreindre une vue transverse.
    await tx.execute(sql`SELECT set_config('app.current_tenant', '', true)`)
    await tx.execute(sql`SELECT set_config('app.user_role', 'superadmin', true)`)
    return fn(tx as unknown as PostgresJsDatabase<typeof schema>)
  })
}

/**
 * Résolution du tenant depuis un domaine (sous-domaine du client).
 * Utilisée par le middleware avant toute requête.
 *
 * `mg-perfume` → tenant slug `mg-perfume` → UUID stocké dans `tenant_domains`.
 */
export async function resolveTenantByHost(host: string): Promise<string | null> {
  const rows = (await getDb().execute(sql`
    SELECT * FROM app_resolve_tenant_by_host(${host})
  `)) as unknown as { id: string }[]
  return rows[0]?.id ?? null
}

export interface TenantRow {
  id: string
  slug: string
  name: string
  locale: string
  modules: unknown
  theme: unknown
}

/**
 * Lecture d'un tenant par slug (avant session) — échoue fermé si absent.
 *
 * Passe par la fonction SECURITY DEFINER `app_resolve_tenant` : la table
 * `tenants` étant sous RLS, une lecture directe exigerait déjà de connaître le
 * tenant — c'est-à-dire ce qu'on cherche à déterminer. La fonction retourne
 * uniquement la correspondance slug → identité, aucun contenu.
 */
export async function getTenantBySlug(slug: string): Promise<TenantRow | null> {
  const rows = (await getDb().execute(sql`
    SELECT * FROM app_resolve_tenant(${slug})
  `)) as unknown as TenantRow[]
  return rows[0] ?? null
}
