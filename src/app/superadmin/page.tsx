import { redirect } from 'next/navigation'
import Link from 'next/link'
import { sql } from 'drizzle-orm'
import { asSuperAdmin } from '@/db'
import { requireSuperAdmin } from '@/core/session'
import { MODULE_REGISTRY, resolveEnabled, type ModuleKey } from '@/core/modules'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

/* ─────────────────────────────────────────────────── garde superadmin ── */
/* La garde vit dans core/session.ts (`requireSuperAdmin`) : elle ne résout
   aucun tenant. Resoudre un sous-domaine ici rendait la console inatteignable
   hors production, où l'hôte n'est jamais un slug client. */

/* ─────────────────────────────────────────────────────────── lecture ── */

/**
 * Liste des tenants.
 *
 * Un superadmin traverse les tenants : il n'y a pas de tenant courant. La
 * lecture se fait dans `asSuperAdmin`, qui pose le GUC `app.user_role`
 * attendu par `app_is_superadmin()`. Un `getDb()` nu ne suffit PAS : le RLS
 * filtre alors la liste en silence et la console affiche « 0 site ».
 */
export default async function SuperAdminPage() {
  await requireSuperAdmin()

  const rows = await asSuperAdmin(async (tx) => {
    const r = await tx.execute(sql`
      SELECT t.id::text, t.slug, t.name, t.status, t.modules, t.created_at,
             (SELECT count(*) FROM products p WHERE p.tenant_id = t.id) AS product_count
        FROM tenants t
       ORDER BY t.name
    `)
    return r as unknown as {
      id: string; slug: string; name: string; status: string
      modules: unknown; created_at: Date; product_count: number
    }[]
  })

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
                  <h2 className="display-sm text-lg text-[var(--ink)]">{t.name}</h2>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {t.slug} · {t.product_count} produit{t.product_count > 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Sans ce lien, la console est un cul-de-sac : on y
                      active des modules sans jamais voir le site concerné. */}
                  <Link href={`/admin/${t.slug}`} className="btn-ghost">
                    Ouvrir le site
                  </Link>
                  <span className="label rounded-full px-3 py-1"
                    style={{
                      border: '1px solid var(--border)',
                      color: t.status === 'active' ? 'var(--accent-text)' : 'var(--muted)',
                    }}>
                    {t.status}
                  </span>
                </div>
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
 * Lecture ET écriture passent par `asSuperAdmin`. L'écriture surtout : un
 * `UPDATE tenants` effectué sans le GUC `app.user_role` est écarté par la
 * politique RLS sans lever d'erreur — le bouton semblait répondre
 * « activé » alors que
 * rien n'était enregistré. La ligne visée est relue après coup pour que
 * l'écran reflète la base et non l'intention.
 */
async function toggleModule(formData: FormData) {
  'use server'
  await requireSuperAdmin()

  const tenantId = String(formData.get('tenantId') ?? '')
  const moduleKey = String(formData.get('moduleKey') ?? '') as ModuleKey

  if (!tenantId || !MODULE_REGISTRY.some((m) => m.key === moduleKey)) {
    throw new Error('Requête invalide')
  }

  await asSuperAdmin(async (tx) => {
    const current = (await tx.execute(sql`
      SELECT modules FROM tenants WHERE id = ${tenantId} LIMIT 1
    `)) as unknown as { modules: ModuleKey[] }[]

    if (!current[0]) throw new Error('Site introuvable')

    const existing = resolveEnabled(current[0].modules)
    const next = existing.includes(moduleKey)
      ? existing.filter((k) => k !== moduleKey)
      : resolveEnabled([...existing, moduleKey])

    const written = await tx.execute(sql`
      UPDATE tenants
         SET modules = ${JSON.stringify(next)}::jsonb,
             updated_at = now()
       WHERE id = ${tenantId}
      RETURNING id::text
    `)

    if ((written as unknown as unknown[]).length === 0) {
      throw new Error("Le site n'a pas pu être modifié.")
    }
  })

  revalidatePath('/superadmin')
}