/**
 * dashboard.ts — Agrégats du tableau de bord.
 *
 * Toutes les lectures passent par `withTenant`, sans exception : c'est RLS,
 * pas le code, qui décide de ce qu'un tenant voit. Une requête écrite hors de
 * ce contexte ne renvoie pas une erreur — elle renvoie zéro ligne. C'est le
 * mode de défaillance le plus Dangereux possible pour un tableau de bord, et
 * la raison pour laquelle chaque fonction ci-dessous est enveloppée.
 *
 * Deuxième règle : on ne compte que les tables dont le module EST actif.
 * Un module désactivé n'est pas « vide », il est « absent » — l'afficher
 * comme zéro revient à annoncer au client qu'il n'a rien, alors que personne
 * ne lui a jamais proposé la fonctionnalité.
 */

import { sql } from 'drizzle-orm'
import { withTenant, type TenantContext } from '@/db'
import { permissionAllowed, type ModuleKey } from '@/core/modules'

export interface ActivityEntry {
  entity: string
  action: string
  actorEmail: string | null
  createdAt: string
}

export interface HealthCheck {
  /** Identifiant stable, pour la clé React. */
  id: string
  label: string
  detail: string
  /** Module à activer ou contenu à compléter. */
  module: ModuleKey
  severity: 'critique' | 'attention'
}

export interface RecentProduct {
  id: string
  name: string
  slug: string
  price: string
  image: string | null
  imageAlt: string | null
  inStock: boolean
  categoryLabel: string | null
}

export interface DashboardData {
  products: number
  activeProducts: number
  outOfStock: number
  /** Valeur du catalogue actif, en FCFA. */
  catalogueValue: number
  categories: number
  banners: number
  media: number
  leads: number
  newLeads: number
  /** Vrai si `site_settings` n'a jamais été rempli. */
  settingsEmpty: boolean
  activity: ActivityEntry[]
  health: HealthCheck[]
  recentProducts: RecentProduct[]
}

/** Module actif ET lisible par le rôle courant. */
function visible(modules: ModuleKey[], key: ModuleKey): boolean {
  return permissionAllowed(modules, key, 'read')
}

export async function getDashboard(
  ctx: TenantContext,
  modules: ModuleKey[],
): Promise<DashboardData> {
  const has = {
    products: visible(modules, 'products'),
    categories: visible(modules, 'categories'),
    banners: visible(modules, 'banners'),
    media: visible(modules, 'media'),
    leads: visible(modules, 'leads'),
    settings: visible(modules, 'settings'),
  }

  return withTenant(ctx, async (tx) => {
    /**
     * Un seul aller-retour pour tous les compteurs : une seule transaction,
     * donc un seul contexte RLS, donc aucune fenêtre où deux requêtes
     * pourraient voir deux états différents du catalogue.
     *
     * Les sous-requêtes sont toutes correlées au même `tenant_id`, lié au
     * tenant de la session — jamais à un paramètre reçu du client.
     */
    const counts = await tx.execute(sql`
      SELECT
        (SELECT count(*)::text                FROM products      WHERE tenant_id = ${ctx.tenantId}) AS products,
        (SELECT count(*)::text                FROM products      WHERE tenant_id = ${ctx.tenantId} AND is_active) AS active_products,
        (SELECT count(*)::text                FROM products      WHERE tenant_id = ${ctx.tenantId} AND NOT in_stock) AS out_of_stock,
        (SELECT COALESCE(sum(price),0)::text  FROM products      WHERE tenant_id = ${ctx.tenantId} AND is_active) AS catalogue_value,
        (SELECT count(*)::text                FROM categories    WHERE tenant_id = ${ctx.tenantId}) AS categories,
        (SELECT count(*)::text                FROM banners       WHERE tenant_id = ${ctx.tenantId}) AS banners,
        (SELECT count(*)::text                FROM media         WHERE tenant_id = ${ctx.tenantId}) AS media,
        (SELECT count(*)::text                FROM leads         WHERE tenant_id = ${ctx.tenantId}) AS leads,
        (SELECT count(*)::text                FROM leads         WHERE tenant_id = ${ctx.tenantId} AND status = 'new') AS new_leads,
        (SELECT count(*)::text                FROM site_settings WHERE tenant_id = ${ctx.tenantId}) AS settings_rows
    `)
    const c = ((counts as unknown as Record<string, string>[])[0] ?? {}) as Record<string, string>

    /* Journal d'activité — toujours lisible : c'est le journal de sécurité. */
    const activityRows = await tx.execute(sql`
      SELECT entity, action::text AS action, actor_email, created_at
        FROM audit_events
       WHERE tenant_id = ${ctx.tenantId}
       ORDER BY created_at DESC
       LIMIT 8
    `)

    /* Derniers produits — pour que le tableau de bord montre le site réel. */
    const productRows = has.products
      ? await tx.execute(sql`
          SELECT p.id::text, p.name, p.slug, p.price::text, p.image, p.image_alt,
                 p.in_stock, c.label AS category_label
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
           WHERE p.tenant_id = ${ctx.tenantId}
           ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
           LIMIT 4
        `)
      : []

    const n = (v: string | null | undefined) => Number(v ?? 0)

    const data: DashboardData = {
      products: has.products ? n(c.products) : 0,
      activeProducts: has.products ? n(c.active_products) : 0,
      outOfStock: has.products ? n(c.out_of_stock) : 0,
      catalogueValue: has.products ? n(c.catalogue_value) : 0,
      categories: has.categories ? n(c.categories) : 0,
      banners: has.banners ? n(c.banners) : 0,
      media: has.media ? n(c.media) : 0,
      leads: has.leads ? n(c.leads) : 0,
      newLeads: has.leads ? n(c.new_leads) : 0,
      settingsEmpty: has.settings && n(c.settings_rows) === 0,
      activity: (activityRows as unknown as {
        entity: string; action: string; actor_email: string | null; created_at: string
      }[]).map((r) => ({
        entity: r.entity,
        action: r.action,
        actorEmail: r.actor_email,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      health: [],
      recentProducts: (productRows as unknown as {
        id: string; name: string; slug: string; price: string; image: string | null;
        image_alt: string | null; in_stock: boolean; category_label: string | null
      }[]).map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        price: r.price,
        image: r.image,
        imageAlt: r.image_alt,
        inStock: r.in_stock,
        categoryLabel: r.category_label,
      })),
    }

    /* Points d'attention — ce que le client doit faire, pas ce qu'il a. */
    const health: HealthCheck[] = []
    if (has.settings && data.settingsEmpty) {
      health.push({
        id: 'settings',
        label: 'Réglages du site non renseignés',
        detail: 'Coordonnées, horaires et SEO manquants — ils alimentent le pied de page et les résultats Google.',
        module: 'settings',
        severity: 'critique',
      })
    }
    if (has.products && data.products === 0) {
      health.push({
        id: 'catalogue',
        label: 'Catalogue vide',
        detail: 'Aucun produit. Le site affiche une page sans contenu.',
        module: 'products',
        severity: 'critique',
      })
    }
    if (has.categories && data.categories === 0 && data.products > 0) {
      health.push({
        id: 'categories',
        label: 'Produits sans catégorie',
        detail: 'Le filtre du catalogue ne peut pas se construire sans familles.',
        module: 'categories',
        severity: 'attention',
      })
    }
    if (has.banners && data.banners === 0) {
      health.push({
        id: 'banners',
        label: 'Aucune bannière',
        detail: "L'accueil n'a pas d'image principale.",
        module: 'banners',
        severity: 'attention',
      })
    }
    if (has.products && data.outOfStock > 0) {
      health.push({
        id: 'stock',
        label: `${data.outOfStock} produit${data.outOfStock > 1 ? 's' : ''} en rupture`,
        detail: 'Affichés « Rupture » sur le site. À réapprovisionner ou à retirer.',
        module: 'products',
        severity: 'attention',
      })
    }
    if (has.media && data.products > 0 && data.media === 0) {
      health.push({
        id: 'media',
        label: 'Médiathèque vide',
        detail: 'Les visuels du catalogue viennent d\'ailleurs : ils ne sont pas versionnés ici.',
        module: 'media',
        severity: 'attention',
      })
    }
    data.health = health

    return data
  })
}

/** « il y a 3 heures » — sans dépendance et dans la locale du site. */
export function relativeTime(iso: string): string {
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
    ['hour', 3600000], ['minute', 60000],
  ]
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return "à l'instant"
}