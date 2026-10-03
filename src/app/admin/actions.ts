'use server'

/**
 * actions.ts — Écritures de l'administration.
 *
 * Chaque action suit EXACTEMENT le même chemin. C'est volontaire : c'est ce
 * chemin qui rend l'admin sûr, donc il ne doit pas exister de raccourci.
 *
 *   1. session      → tenant + rôle dérivés de la session serveur
 *   2. module       → le module est-il actif pour ce tenant ?
 *   3. permission   → le rôle a-t-il le droit requis ?
 *   4. validation   → Zod sur l'entrée
 *   5. withTenant   → positionne le contexte RLS
 *   6. withAudit    → journalise DANS la transaction
 *
 * Aucun de ces six sauts n'est facultatif.
 */

import { z } from 'zod'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { withTenant } from '@/db'
import * as schema from '@/db/schema'
import { resolveSession } from '@/core/session'
import { permissionAllowed, type ModuleKey, type Permission } from '@/core/modules'
import { withAudit } from '@/core/audit'
import { ForbiddenError, toMessage } from '@/core/errors'

/**
 * Garde-fou commun : résout la session et vérifie module + permission.
 * Retourne le contexte prêt à l'emploi, ou lève.
 */
async function guard(slug: string, module: ModuleKey, perm: Permission) {
  const session = await resolveSession(slug)
  if (!session) throw new ForbiddenError()

  if (!permissionAllowed(session.tenant.modules, module, perm)) {
    throw new ForbiddenError()
  }

  return session
}

/** Métadonnées d'audit depuis la requête courante. */
async function requestMeta() {
  const h = await headers()
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
  }
}

/* ─────────────────────────────────────────────────────────── produits ── */

const productInput = z.object({
  name: z.string().min(1, 'Nom requis').max(200),
  slug: z.string().min(1).max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug : minuscules, chiffres et tirets'),
  brand: z.string().max(120).nullish(),
  price: z.coerce.number().nonnegative(),
  compareAt: z.coerce.number().nonnegative().nullish(),
  categoryId: z.string().uuid().nullish(),
  image: z.string().max(500).nullish(),
  imageAlt: z.string().max(300).nullish(),
  shortDesc: z.string().max(400).nullish(),
  description: z.string().max(8000).nullish(),
  badge: z.string().max(60).nullish(),
  inStock: z.boolean().default(true),
  isActive: z.boolean().default(true),
  featuredSlot: z.string().max(24).nullish(),
  specs: z.record(z.string(), z.unknown()).default({}),
  features: z.array(z.string().max(300)).default([]),
})

export type ProductActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

/** Crée un produit. */
export async function createProduct(
  slug: string,
  input: unknown,
): Promise<ProductActionResult> {
  const session = await guard(slug, 'products', 'create')
  const parsed = productInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }
  const data = parsed.data
  const meta = await requestMeta()

  try {
    const id = await withTenant(session.ctx, (tx) =>
      withAudit(
        tx,
        { tenantId: session.ctx.tenantId, userId: session.user.id,
          userEmail: session.user.email, ...meta },
        { entity: 'product', action: 'create' },
        async (t): Promise<string | undefined> => {
          const rows = await t.execute(sql`
            INSERT INTO products
              (tenant_id, category_id, slug, name, brand, price, compare_at, image,
               image_alt, short_desc, description, badge, in_stock, is_active,
               featured_slot, specs, features, published_at)
            VALUES (
              ${session.ctx.tenantId}, ${data.categoryId ?? null}, ${data.slug},
              ${data.name}, ${data.brand ?? null}, ${data.price},
              ${data.compareAt ?? null}, ${data.image ?? null}, ${data.imageAlt ?? null},
              ${data.shortDesc ?? null}, ${data.description ?? null},
              ${data.badge ?? null}, ${data.inStock}, ${data.isActive},
              ${data.featuredSlot ?? null},
              ${JSON.stringify(data.specs)}::jsonb,
              ${JSON.stringify(data.features)}::jsonb,
              now()
            )
            RETURNING id::text
          `)
          return ((rows as unknown as { id: string }[])[0])?.id
        },
      ),
    )

    revalidatePath(`/admin/${slug}/products`)
    return { ok: true, id: id ?? '' }
  } catch (err) {
    return { ok: false, error: toMessage(err) }
  }
}

/** Met à jour un produit. */
export async function updateProduct(
  slug: string,
  id: string,
  input: unknown,
): Promise<ProductActionResult> {
  const session = await guard(slug, 'products', 'update')
  const parsed = productInput.partial().safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }
  const data = parsed.data
  const meta = await requestMeta()

  try {
    await withTenant(session.ctx, (tx) =>
      withAudit(
        tx,
        { tenantId: session.ctx.tenantId, userId: session.user.id,
          userEmail: session.user.email, ...meta },
        {
          entity: 'product',
          entityId: id,
          action: 'update',
          // L'état AVANT est relu DANS la transaction : le diff reste exact
          // même en cas d'édition concurrente.
          readBefore: async (t) => {
            const rows = await tx.execute(sql`
              SELECT row_to_json(p) FROM products p
               WHERE p.id = ${id} AND p.tenant_id = ${session.ctx.tenantId}
            `)
            return ((rows as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>
          },
        },
        async (t) => {
          /* Construction dynamique du SET.
           *
           * Écrire `colonne = ${data.x ?? null}` est un piège : le schéma est
           * `.partial()`, donc une action qui ne reçoit QUE `isActive` passe la
           * validation et met `brand`, `image`, `category_id`... à NULL. Un
           * simple bouton « masquer » effacerait la photo du produit.
           *
           * Ici absent n'est pas égal à vide : une clé absente du payload ne
           * produit aucune colonne ; une clé présente à `null` écrit
           * explicitement NULL — le seul moyen de vider un champ.
           */
          const DB_COL: Record<string, string> = {
            name: 'name', slug: 'slug', brand: 'brand', price: 'price',
            compareAt: 'compare_at', categoryId: 'category_id', image: 'image',
            imageAlt: 'image_alt', shortDesc: 'short_desc', description: 'description',
            badge: 'badge', inStock: 'in_stock', isActive: 'is_active',
            featuredSlot: 'featured_slot', specs: 'specs', features: 'features',
          }
          const values: Record<string, unknown> = {
            name: data.name, slug: data.slug, brand: data.brand,
            price: data.price, compareAt: data.compareAt, categoryId: data.categoryId,
            image: data.image, imageAlt: data.imageAlt, shortDesc: data.shortDesc,
            description: data.description, badge: data.badge,
            inStock: data.inStock, isActive: data.isActive, featuredSlot: data.featuredSlot,
            specs: data.specs ? JSON.stringify(data.specs) : undefined,
            features: data.features ? JSON.stringify(data.features) : undefined,
          }

          const sets: SQL[] = []
          for (const [key, value] of Object.entries(values)) {
            if (value === undefined) continue            // absent -> colonne intacte
            const col = sql.identifier(DB_COL[key]!)
            const isJson = key === 'specs' || key === 'features'
            sets.push(
              value === null
                ? sql`${col} = NULL`
                : isJson
                  ? sql`${col} = ${value}::jsonb`
                  : sql`${col} = ${value}`,
            )
          }

          // Aucun champ fourni : on relit l'état plutôt que d'émettre un
          // UPDATE vide, et le journal d'audit verra un diff nul -> rien écrit.
          if (sets.length === 0) {
            const unchanged = await t.execute(sql`
              SELECT row_to_json(p) FROM products p
               WHERE p.id = ${id} AND p.tenant_id = ${session.ctx.tenantId}
            `)
            return ((unchanged as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>
          }

          // RETURNING : un UPDATE écarté par le RLS n'affecte aucune ligne
          // sans lever d'erreur. Sans cette vérification, l'écran
          // afficherait « enregistré » alors que rien n'a bougé.
          const written = await t.execute(sql`
            UPDATE products SET ${sql.join(sets, sql`, `)}, updated_at = now()
             WHERE id = ${id} AND tenant_id = ${session.ctx.tenantId}
            RETURNING id::text
          `)

          if ((written as unknown as unknown[]).length === 0) {
            throw new ForbiddenError(
              "Modification refusée : ce produit ne vous appartient pas ou votre rôle ne l'autorise pas.",
            )
          }

          const after = await t.execute(sql`
            SELECT row_to_json(p) FROM products p
             WHERE p.id = ${id} AND p.tenant_id = ${session.ctx.tenantId}
          `)
          return ((after as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>
        },
      ),
    )

    revalidatePath(`/admin/${slug}/products`)
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: toMessage(err) }
  }
}

/** Supprime un produit — réservé au rôle `manager` (contrôle par RLS aussi). */
export async function deleteProduct(
  slug: string,
  id: string,
): Promise<ProductActionResult> {
  const session = await guard(slug, 'products', 'delete')
  const meta = await requestMeta()

  try {
    await withTenant(session.ctx, (tx) =>
      withAudit(
        tx,
        { tenantId: session.ctx.tenantId, userId: session.user.id,
          userEmail: session.user.email, ...meta },
        { entity: 'product', entityId: id, action: 'delete' },
        async (t) => {
          const before = await t.execute(sql`
            SELECT row_to_json(p) FROM products p
             WHERE p.id = ${id} AND p.tenant_id = ${session.ctx.tenantId}
          `)

          /* RETURNING est obligatoire ici.
           *
           * Un DELETE refusé par le RLS ne lève pas d'erreur : la clause USING
           * filtre la ligne et l'instruction affecte zéro ligne, sans bruit.
           * Sans RETURNING, l'action répondrait « supprimé » alors que le
           * produit est toujours là — et le journal d'audit enregistrerait une
           * suppression qui n'a pas eu lieu.
           *
           * Avec RETURNING, zéro ligne signifie « rien supprimé », et
           * l'action remonte un refus explicite.
           */
          const removed = await t.execute(sql`
            DELETE FROM products
             WHERE id = ${id} AND tenant_id = ${session.ctx.tenantId}
            RETURNING id::text
          `)

          if ((removed as unknown as unknown[]).length === 0) {
            throw new ForbiddenError(
              "Suppression refusée : ce produit ne vous appartient pas ou votre rôle ne l'autorise pas.",
            )
          }

          return ((before as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>
        },
      ),
    )

    revalidatePath(`/admin/${slug}/products`)
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: toMessage(err) }
  }
}

/* ─────────────────────────────────────────────────────────── interne ── */


/** Lecture d'une liste de produits (RLS + module guard). */
export async function listProducts(slug: string) {
  const session = await guard(slug, 'products', 'read')

  return withTenant(session.ctx, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT p.id::text, p.slug, p.name, p.brand, p.price::text,
             p.image, p.badge, p.in_stock, p.is_active, p.featured_slot,
             c.slug AS category_slug, p.updated_at
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.tenant_id = ${session.ctx.tenantId}
       ORDER BY p.is_active DESC, p.position, p.name
    `)
    return rows as unknown as Record<string, unknown>[]
  })
}
/**
 * Lecture d'un produit pour le formulaire d'édition.
 *
 * Séparée de `listProducts` : le formulaire a besoin de la description, des
 * caractéristiques et de `specs`, qu'une liste n'affiche pas. Le `id` vient de
 * l'URL mais n'est JAMAIS utilisé pour choisir le tenant — celui-ci vient de
 * la session, et la clause `tenant_id` fait le reste.
 */
export async function getProductForEdit(slug: string, id: string) {
  const session = await guard(slug, 'products', 'read')

  const rows = await withTenant(session.ctx, async (tx) => {
    const r = await tx.execute(sql`
      SELECT p.id::text, p.name, p.slug, p.brand, p.price::text, p.image, p.image_alt,
             p.short_desc, p.description, p.badge, p.in_stock, p.is_active,
             p.featured_slot, p.specs, p.features, p.category_id::text, p.compare_at::text
        FROM products p
       WHERE p.id = ${id} AND p.tenant_id = ${session.ctx.tenantId}
       LIMIT 1
    `)
    return r as unknown as Record<string, unknown>[]
  })

  return rows[0] ?? null
}
