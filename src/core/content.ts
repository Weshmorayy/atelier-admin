/**
 * content.ts — Point d'accès UNIQUE au contenu, côté site client.
 *
 * C'est ce fichier qui permet à un même dépôt de site client de servir
 * n'importe quel tenant. Le site ne connaît ni la base, ni les tables : il
 * appelle ce module.
 *
 * MODE `build` — le contenu est récupéré au build (SSG). L'enregistrement dans
 * l'admin déclenche un deploy hook Coolify → rebuild. SEO et performance
 * optimaux. RECOMMANDÉ par défaut.
 * MODE `live` — récupéré en Server Component. Mise à jour immédiate, exige Node.
 *
 * ⚠ Toute lecture passe par `withTenant`. Sans contexte tenant, les politiques
 *   RLS filtrent TOUTES les lignes (échec fermé) et l'API renvoie un catalogue
 *   vide — un échec silencieux, donc difficile à diagnostiquer ensuite.
 */

import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { getTenantBySlug, withTenant } from '@/db'
import { resolveEnabled, type ModuleKey } from '@/core/modules'
import { resolveTheme } from '@/core/theme'

export interface ProductSummary {
  slug: string
  name: string
  brand: string | null
  price: string
  compareAt: string | null
  image: string | null
  imageAlt: string | null
  shortDesc: string | null
  specs: Record<string, unknown>
  features: string[]
  badge: string | null
  inStock: boolean
  featuredSlot: string | null
  categorySlug: string | null
}

export interface CategorySummary { slug: string; label: string; position: number }

export interface BannerItem {
  slot: string
  title: string | null
  subtitle: string | null
  image: string | null
  imageAlt: string | null
  ctaLabel: string | null
  ctaHref: string | null
  position: number
}

export interface FaqItem { question: string; answer: string }
export interface PostSummary {
  slug: string
  title: string
  excerpt: string | null
  cover: string | null
  publishedAt: string | null
  categorySlug: string | null
}

export interface SiteContent {
  tenant: { slug: string; name: string; locale: string }
  modules: ModuleKey[]
  theme: ReturnType<typeof resolveTheme>
  settings: Record<string, unknown>
  products: ProductSummary[]
  categories: CategorySummary[]
  banners: BannerItem[]
  faqs: FaqItem[]
  blogPosts: PostSummary[]
}

const EMPTY: unknown[] = []

/**
 * Récupéré une seule fois par rendu React : trois composants qui appellent
 * `getSiteContent()` dans le même rendu ne déclenchent qu'une seule requête.
 */
export const getSiteContent = cache(async (tenantSlug: string): Promise<SiteContent> => {
  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) throw new Error(`Tenant introuvable ou suspendu : ${tenantSlug}`)

  const tenantId = tenant.id
  const modules = resolveEnabled(tenant.modules)
  const has = (k: ModuleKey) => modules.includes(k)

  const data = await withTenant({ tenantId, role: 'viewer' }, async (tx) => {
    // Chaque lecture est conditionnée au module : un site sans blog
    // n'interroge pas la table blog.
    const [settings, products, categories, banners, faqs, posts] = await Promise.all([
      has('settings')
        ? tx.execute(sql`
            SELECT contact, social, hours, seo, payments, delivery, legal
              FROM site_settings WHERE tenant_id = ${tenantId} LIMIT 1`)
        : Promise.resolve(EMPTY),

      has('products')
        ? tx.execute(sql`
            SELECT p.slug, p.name, p.brand, p.price, p.compare_at AS compareAt,
                   p.image, p.image_alt AS imageAlt, p.short_desc AS shortDesc,
                   p.specs, p.features, p.badge, p.in_stock AS inStock,
                   p.featured_slot AS featuredSlot, c.slug AS categorySlug
              FROM products p
              LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
             WHERE p.tenant_id = ${tenantId}
               AND p.is_active = true
               AND (p.published_at IS NULL OR p.published_at <= now())
             ORDER BY p.position, p.created_at`)
        : Promise.resolve(EMPTY),

      has('categories')
        ? tx.execute(sql`
            SELECT slug, label, position FROM categories
             WHERE tenant_id = ${tenantId} ORDER BY position`)
        : Promise.resolve(EMPTY),

      has('banners')
        ? tx.execute(sql`
            SELECT slot, title, subtitle, image, image_alt AS imageAlt,
                   cta_label AS ctaLabel, cta_href AS ctaHref, position
              FROM banners
             WHERE tenant_id = ${tenantId} AND active = true
             ORDER BY slot, position`)
        : Promise.resolve(EMPTY),

      has('faq')
        ? tx.execute(sql`
            SELECT question, answer FROM faqs
             WHERE tenant_id = ${tenantId} ORDER BY position`)
        : Promise.resolve(EMPTY),

      has('blog')
        ? tx.execute(sql`
            SELECT slug, title, excerpt, cover, published_at AS publishedAt,
                   category_slug AS categorySlug
              FROM blog_posts
             WHERE tenant_id = ${tenantId}
               AND status = 'published'
               AND published_at <= now()
             ORDER BY published_at DESC
             LIMIT 20`)
        : Promise.resolve(EMPTY),
    ])

    return { settings, products, categories, banners, faqs, posts }
  })

  const first = <T,>(rows: unknown): T | null =>
    ((rows as unknown as T[]) ?? [])[0] ?? null

  return {
    tenant: { slug: tenant.slug, name: tenant.name, locale: tenant.locale },
    modules,
    theme: resolveTheme(tenant.theme),
    settings: (first<Record<string, unknown>>(data.settings) ?? {}) as Record<string, unknown>,
    products: (data.products as unknown as ProductSummary[]) ?? [],
    categories: (data.categories as unknown as CategorySummary[]) ?? [],
    banners: (data.banners as unknown as BannerItem[]) ?? [],
    faqs: (data.faqs as unknown as FaqItem[]) ?? [],
    blogPosts: (data.posts as unknown as PostSummary[]) ?? [],
  }
})

/** Le site n'affiche que les slots publiés par l'admin. */
export function bannersForSlot(content: SiteContent, slot: string): BannerItem[] {
  return content.banners
    .filter((b) => b.slot === slot)
    .sort((a, b) => a.position - b.position)
}