/**
 * content.ts — Point d'accès UNIQUE au contenu, côté site client.
 *
 * C'est ce fichier qui permet à un même dépôt de site client de servir
 * n'importe quel tenant. Le site ne connaît ni la base, ni les tables : il
 * appelle ce module.
 *
 * MODE `build` — le contenu est récupéré au build (SSG). L'enregistrement dans
 * l'admin déclenche un deploy hook Coolify → rebuild. SEO et performance
 * optimaux, hébergement statique possible. RECOMMANDÉ par défaut.
 * MODE `live` — récupéré en Server Component. Mise à jour immédiate, exige Node.
 */

import { cache } from 'react'
import { getDb } from '@/db'
import { sql } from 'drizzle-orm'
import { resolveEnabled, type ModuleKey } from '@/core/modules'
import { resolveTheme } from '@/core/theme'

export type ContentMode = 'build' | 'live'

export interface SiteContent {
  tenant: {
    slug: string
    name: string
    locale: string
  }
  modules: ModuleKey[]
  theme: ReturnType<typeof resolveTheme>
  settings: Record<string, unknown>
  products: ProductSummary[]
  categories: CategorySummary[]
  banners: BannerItem[]
  faqs: FaqItem[]
  blogPosts: PostSummary[]
}

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

export interface CategorySummary {
  slug: string
  label: string
  position: number
}

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

/**
 * Récupéré une seule fois par rendu React.
 *
 * `cache()` déduplique : si trois composants appellent `getSiteContent()` dans
 * le même rendu, une seule requête part. Indispensable pour un site entier
 * construit sur ce module.
 */
export const getSiteContent = cache(async (tenantSlug: string): Promise<SiteContent> => {
  const db = getDb()

  const t = await db.execute(sql`
    SELECT id::text AS id, slug, name, locale, modules, theme, status
      FROM tenants
     WHERE slug = ${tenantSlug} AND status = 'active'
     LIMIT 1
  `)
  const tenant = (t as unknown as Record<string, unknown>[])[0]

  if (!tenant) {
    throw new Error(`Tenant introuvable ou suspendu : ${tenantSlug}`)
  }

  const tenantId = String(tenant.id)
  const modules = resolveEnabled(tenant.modules)
  const has = (k: ModuleKey) => modules.includes(k)

  // Requêtes conditionnelles : un site sans blog n'interroge pas le blog.
  const [settings, products, categories, banners, faqs, posts] = await Promise.all([
    has('settings')
      ? db.execute(sql`
          SELECT contact, social, hours, seo, payments, delivery, legal
            FROM site_settings WHERE tenant_id = ${tenantId} LIMIT 1`)
      : Promise.resolve([]),

    has('products')
      ? db.execute(sql`
          SELECT p.slug, p.name, p.brand, p.price, p.compare_at AS compareAt,
                 p.image, p.image_alt AS imageAlt, p.short_desc AS shortDesc,
                 p.specs, p.features, p.badge, p.in_stock AS inStock,
                 p.featured_slot AS featuredSlot, c.slug AS categorySlug
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
           WHERE p.tenant_id = ${tenantId}
             AND p.is_active = true
             AND (p.published_at IS NULL OR p.published_at <= now())
           ORDER BY p.position, p.created_at`)
      : Promise.resolve([]),

    has('categories')
      ? db.execute(sql`
          SELECT slug, label, position FROM categories
           WHERE tenant_id = ${tenantId} ORDER BY position`)
      : Promise.resolve([]),

    has('banners')
      ? db.execute(sql`
          SELECT slot, title, subtitle, image, image_alt AS imageAlt,
                 cta_label AS ctaLabel, cta_href AS ctaHref, position
            FROM banners
           WHERE tenant_id = ${tenantId} AND active = true
           ORDER BY slot, position`)
      : Promise.resolve([]),

    has('faq')
      ? db.execute(sql`
          SELECT question, answer FROM faqs
           WHERE tenant_id = ${tenantId} ORDER BY position`)
      : Promise.resolve([]),

    has('blog')
      ? db.execute(sql`
          SELECT slug, title, excerpt, cover, published_at AS publishedAt,
                 category_slug AS categorySlug
            FROM blog_posts
           WHERE tenant_id = ${tenantId}
             AND status = 'published'
             AND published_at <= now()
           ORDER BY published_at DESC
           LIMIT 20`)
      : Promise.resolve([]),
  ])

  const first = <T,>(rows: unknown): T | null =>
    ((rows as unknown as T[]) ?? [])[0] ?? null

  return {
    tenant: {
      slug: String(tenant.slug),
      name: String(tenant.name),
      locale: String(tenant.locale ?? 'fr'),
    },
    modules,
    theme: resolveTheme(tenant.theme),
    settings: (first<Record<string, unknown>>(settings) ?? {}) as Record<string, unknown>,
    products: (products as unknown as ProductSummary[]) ?? [],
    categories: (categories as unknown as CategorySummary[]) ?? [],
    banners: (banners as unknown as BannerItem[]) ?? [],
    faqs: (faqs as unknown as FaqItem[]) ?? [],
    blogPosts: (posts as unknown as PostSummary[]) ?? [],
  }
})

/** Le site client n'affiche que les slots publiés par l'admin. */
export function bannersForSlot(content: SiteContent, slot: string): BannerItem[] {
  return content.banners.filter((b) => b.slot === slot).sort((a, b) => a.position - b.position)
}