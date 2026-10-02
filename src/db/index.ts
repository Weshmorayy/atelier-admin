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
 * Résolution du tenant depuis un domaine (sous-domaine du client).
 * Utilisée par le middleware avant toute requête.
 *
 * `mg-perfume` → tenant slug `mg-perfume` → UUID stocké dans `tenant_domains`.
 */
export async function resolveTenantByHost(host: string): Promise<string | null> {
  const clean = host.split(':')[0].toLowerCase()
  const rows = (await getDb().execute(sql`
    SELECT td.tenant_id::text AS tenant_id
      FROM tenant_domains td
      JOIN tenants t ON t.id = td.tenant_id
     WHERE lower(td.domain) = ${clean}
       AND t.status = 'active'
     LIMIT 1
  `)) as unknown as { tenant_id: string }[]
  return rows[0]?.tenant_id ?? null
}

/** Lecture d'un tenant par slug (avant session) — échoue fermé si absent. */
export async function getTenantBySlug(slug: string) {
  const rows = (await getDb().execute(sql`
    SELECT id::text AS id, slug, name, modules, theme, locale, status
      FROM tenants WHERE slug = ${slug} AND status = 'active' LIMIT 1
  `)) as unknown as Record<string, unknown>[]
  return rows[0] ?? null
}
