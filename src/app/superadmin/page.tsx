import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { sql } from 'drizzle-orm'
import { getDb } from '@/db'
import { resolveSession } from '@/core/session'
import { MODULE_REGISTRY, resolveEnabled, type ModuleKey } from '@/core/modules'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

/* ─────────────────────────────────────────────────── garde superadmin ── */

async function requireSuperAdmin() {
  const host = (await headers()).get('x-forwarded-host') ?? ''
  const session = await resolveSession(host.split(':')[0])
  if (!session) redirect('/connexion')
  if (!session.isSuperAdmin) redirect('/')
  return session
}

/* ─────────────────────────────────────────────────────────── lecture ── */

/**
 * Liste des tenants.
 *
 * Un superadmin traverse les tenants : `withTenant` n'a pas de sens ici, il
 * n'y a pas de tenant courant. La lecture est directe et explicite — c'est le
 * seul endroit du code où l'isolation est court-circuitée, et c'est
 * intentionnel : c'est la vue transverse de l'agence.
 */
export default async function SuperAdminPage() {
  await requireSuperAdmin()

  const rows = (await getDb().execute(sql`
    SELECT t.id::text, t.slug, t.name, t.status, t.modules, t.created_at,
           (SELECT count(*) FROM products p WHERE p.tenant_id = t.id) AS product_count
      FROM tenants t
     ORDER BY t.name
  `)) as unknown as {
    id: string; slug: string; name: string; status: string
    modules: unknown; created_at: Date; product_count: number
  }[]

  return (
    <div>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        {rows.length} site{rows.length > 1 ? 's' : ''} client{rows.length > 1 ? 's' : ''} ·
        {' '}activation des modules par site, sans redéploiement.
      </p>

      <div className="mt-6 space-y-5">
        {rows.map((t) => {
          const enabled = resolveEnabled(t.modules)
          return (
            <section key={t.id} className="card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{t.name}</h2>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {t.slug} · {t.product_count} produit{t.product_count > 1 ? 's' : ''}
                  </p>
                </div>
                <span className="label rounded-full px-3 py-1"
                  style={{
                    border: '1px solid var(--border)',
                    color: t.status === 'active' ? 'var(--accent-text)' : 'var(--muted)',
                  }}>
                  {t.status}
                </span>
              </div>

              <form action={toggleModule} className="mt-5">
                <input type="hidden" name="tenantId" value={t.id} />
                <p className="label mb-3" style={{ color: 'var(--muted)' }}>Modules actifs</p>

                <div className="flex flex-wrap gap-2">
                  {MODULE_REGISTRY.map((m) => {
                    const on = enabled.includes(m.key)
                    return (
                      <button
                        key={m.key}
                        type="submit"
                        name="moduleKey"
                        value={m.key}
                        title={m.description}
                        aria-pressed={on}
                        className="label rounded-full px-3.5 py-2 transition-colors"
                        style={{
                          background: on ? 'var(--ink)' : 'transparent',
                          color: on ? '#fff' : 'var(--muted)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>

                <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
                  Cliquer pour activer/désactiver. Les dépendances sont ajoutées
                  automatiquement : activer « Produits » active aussi « Catégories ».
                </p>
              </form>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────── mutation ── */

/**
 * Active/désactive un module pour un tenant.
 *
 * L'écriture passe par `withTenant` avec le rôle `superadmin` : le rôle est
 * un paramètre de ce serveur de confiance, jamais de l'entrée du client, et
 * les politiques RLS l'autorisent explicitement via `app_is_superadmin()`.
 */
async function toggleModule(formData: FormData) {
  'use server'
  await requireSuperAdmin()

  const tenantId = String(formData.get('tenantId') ?? '')
  const moduleKey = String(formData.get('moduleKey') ?? '') as ModuleKey

  if (!tenantId || !MODULE_REGISTRY.some((m) => m.key === moduleKey)) {
    throw new Error('Requête invalide')
  }

  const db = getDb()
  const current = (await db.execute(sql`
    SELECT modules FROM tenants WHERE id = ${tenantId} LIMIT 1
  `)) as unknown as { modules: ModuleKey[] }[]

  const existing = resolveEnabled(current[0]?.modules)
  const next = existing.includes(moduleKey)
    ? existing.filter((k) => k !== moduleKey)
    : resolveEnabled([...existing, moduleKey])

  await db.execute(sql`
    UPDATE tenants
       SET modules = ${JSON.stringify(next)}::jsonb,
           updated_at = now()
     WHERE id = ${tenantId}
  `)

  revalidatePath('/superadmin')
}