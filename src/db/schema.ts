/**
 * schema.ts — Schéma Postgres partagé, multi-tenant.
 *
 * Règle absolue : TOUTE table métier porte `tenant_id`, et `tenant_id` est la
 * PREMIÈRE colonne de chaque index. C'est ce qui rend les politiques RLS
 * performantes ; l'inverse est l'erreur la plus fréquente en multi-tenant.
 *
 * La sécurité ne repose PAS sur ces colonnes : elle repose sur les politiques
 * RLS forceées de `rls.sql`. `tenant_id` sert à l'indexation et au tri ;
 * RLS sert à l'isolation.
 */

import {
  pgTable, pgEnum, uuid, text, varchar, integer, boolean, timestamp,
  jsonb, numeric, uniqueIndex, index, primaryKey,
} from 'drizzle-orm/pg-core'

/* ──────────────────────────────────────────────────────────────── énumérations */

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended', 'archived'])
export const productKind   = pgEnum('product_kind', ['physical', 'digital', 'service'])
export const postStatus    = pgEnum('post_status', ['draft', 'scheduled', 'published'])
export const leadStatus    = pgEnum('lead_status', ['new', 'in_progress', 'done', 'spam'])
export const auditAction   = pgEnum('audit_action', ['create', 'update', 'delete', 'restore', 'login', 'logout', 'export', 'import'])

/* ─────────────────────────────────────────────────────────────────── tenancy */

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 63 }).notNull(),
  name: text('name').notNull(),
  status: tenantStatus('status').notNull().default('active'),
  locale: varchar('locale', { length: 8 }).notNull().default('fr'),

  /**
   * Modules ACTIVÉS pour ce tenant. Les TYPES vivent dans `core/modules.ts`
   * (temps de compilation) ; seule l'activation est en base, pour pouvoir
   * activer/désactiver un module sans redéploiement.
   * Type : ModuleKey[]
   */
  modules: jsonb('modules').notNull().default([]),

  /**
   * Identité visuelle du site ET du back-office.
   * Palettes, typographies, rayons, logo, couleurs de marque.
   * Type : TenantTheme (voir core/theme.ts)
   */
  theme: jsonb('theme').notNull().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex('tenants_slug_idx').on(t.slug),
}))

export const tenantDomains = pgTable('tenant_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  domain: varchar('domain', { length: 255 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (t) => ({
  domainIdx: uniqueIndex('tenant_domains_domain_idx').on(t.domain),
  tenantIdx: index('tenant_domains_tenant_idx').on(t.tenantId),
}))

/* ──────────────────────────────────────────────────────────────── catalogue */

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: productKind('kind').notNull().default('physical'),
  slug: varchar('slug', { length: 128 }).notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull().default(0),
}, (t) => ({
  tenantSlugIdx: uniqueIndex('categories_tenant_slug_idx').on(t.tenantId, t.slug),
  tenantPosIdx:  index('categories_tenant_pos_idx').on(t.tenantId, t.position),
}))

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),

  slug: varchar('slug', { length: 160 }).notNull(),
  name: text('name').notNull(),
  /** Marque / collection. Générique : l'apport du domaine client est optionnel. */
  brand: text('brand'),

  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  compareAt: numeric('compare_at', { precision: 12, scale: 2 }),

  /** Chemin public de l'image principale (stockage S3/MinIO). */
  image: text('image'),
  imageAlt: text('image_alt'),
  shortDesc: text('short_desc'),
  description: text('description'),

  /** Domain-specific : structures libres validées par Zod côté admin. */
  specs: jsonb('specs').notNull().default({}),
  features: jsonb('features').notNull().default([]),
  tags: jsonb('tags').notNull().default([]),

  badge: text('badge'),
  sku: varchar('sku', { length: 64 }),
  inStock: boolean('in_stock').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  isFeatured: boolean('is_featured').notNull().default(false),
  /** Rang dans les mises en avant. 1 slot « Étoile », 2-4 « Sélection ». */
  featuredSlot: varchar('featured_slot', { length: 24 }),

  position: integer('position').notNull().default(0),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantSlugIdx: uniqueIndex('products_tenant_slug_idx').on(t.tenantId, t.slug),
  // index composites : tenant_id EN TÊTE
  tenantActiveIdx:  index('products_tenant_active_idx').on(t.tenantId, t.isActive),
  tenantCatIdx:     index('products_tenant_cat_idx').on(t.tenantId, t.categoryId),
  tenantFeaturedIdx:index('products_tenant_featured_idx').on(t.tenantId, t.isFeatured),
  tenantPosIdx:     index('products_tenant_pos_idx').on(t.tenantId, t.position),
}))

export const productImages = pgTable('product_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  alt: text('alt'),
  position: integer('position').notNull().default(0),
}, (t) => ({
  tenantProductIdx: index('product_images_tenant_product_idx').on(t.tenantId, t.productId),
}))

/* ──────────────────────────────────────────────────────────────── éditorial */

export const banners = pgTable('banners', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Emplacement logique : 'home-hero', 'home-strip', 'catalogue-top'… */
  slot: varchar('slot', { length: 48 }).notNull(),
  title: text('title'),
  subtitle: text('subtitle'),
  image: text('image'),
  imageAlt: text('image_alt'),
  ctaLabel: text('cta_label'),
  ctaHref: text('cta_href'),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantSlotIdx:  index('banners_tenant_slot_idx').on(t.tenantId, t.slot),
  tenantPosIdx:   index('banners_tenant_pos_idx').on(t.tenantId, t.position),
}))

/**
 * Pages composites. `blocks` est un tableau discriminated union validé par Zod
 * (voir core/modules.ts → schémas de blocs). Volontairement générique : la
 * structure visuelle appartient au site client, le contenu à l'admin.
 */
export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  slug: varchar('slug', { length: 160 }).notNull(),
  title: text('title').notNull(),
  excerpt: text('excerpt'),
  blocks: jsonb('blocks').notNull().default([]),
  seo: jsonb('seo').notNull().default({}),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantSlugIdx: uniqueIndex('pages_tenant_slug_idx').on(t.tenantId, t.slug),
}))

export const faqs = pgTable('faqs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantPosIdx: index('faqs_tenant_pos_idx').on(t.tenantId, t.position),
}))

/* ───────────────────────────────────────────────────────────────────── blog */

export const blogPosts = pgTable('blog_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id'),
  slug: varchar('slug', { length: 180 }).notNull(),
  title: text('title').notNull(),
  excerpt: text('excerpt'),
  /** Corps au format MDX-lite ou HTML — validé par Zod à l'écriture. */
  body: text('body').notNull().default(''),
  cover: text('cover'),
  coverAlt: text('cover_alt'),
  categorySlug: varchar('category_slug', { length: 80 }),
  tags: jsonb('tags').notNull().default([]),
  status: postStatus('status').notNull().default('draft'),
  seo: jsonb('seo').notNull().default({}),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantSlugIdx: uniqueIndex('blog_posts_tenant_slug_idx').on(t.tenantId, t.slug),
  tenantStatusIdx: index('blog_posts_tenant_status_idx').on(t.tenantId, t.status, t.publishedAt),
}))

/* ───────────────────────────────────────────────────────── réglages du site */

export const siteSettings = pgTable('site_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contact: jsonb('contact').notNull().default({}),
  social: jsonb('social').notNull().default({}),
  hours: jsonb('hours').notNull().default({}),
  seo: jsonb('seo').notNull().default({}),
  payments: jsonb('payments').notNull().default({}),
  delivery: jsonb('delivery').notNull().default({}),
  legal: jsonb('legal').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Un seul jeu de réglages par tenant
  tenantIdx: uniqueIndex('site_settings_tenant_idx').on(t.tenantId),
}))

/* ──────────────────────────────────────────────────────────────── leads / commandes */

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** 'contact' | 'whatsapp_order' | 'devis' | 'newsletter' */
  kind: varchar('kind', { length: 32 }).notNull().default('contact'),
  name: text('name'),
  phone: text('phone'),
  email: text('email'),
  message: text('message'),
  payload: jsonb('payload').notNull().default({}),
  status: leadStatus('status').notNull().default('new'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantStatusIdx: index('leads_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
}))

/* ─────────────────────────────────────────────────────────────────── médias */

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  url: text('url').notNull(),
  mime: varchar('mime', { length: 120 }).notNull(),
  size: integer('size').notNull().default(0),
  width: integer('width'),
  height: integer('height'),
  folder: varchar('folder', { length: 120 }).notNull().default('racine'),
  alt: text('alt'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantKeyIdx:  uniqueIndex('media_tenant_key_idx').on(t.tenantId, t.key),
  tenantFolderIdx: index('media_tenant_folder_idx').on(t.tenantId, t.folder),
}))

/* ─────────────────────────────────────────────────────────── audit (append-only) */

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  actorId: uuid('actor_id'),
  actorEmail: text('actor_email'),
  entity: varchar('entity', { length: 64 }).notNull(),
  entityId: text('entity_id'),
  action: auditAction('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: varchar('ip', { length: 64 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantTimeIdx: index('audit_events_tenant_time_idx').on(t.tenantId, t.createdAt),
  entityIdx:     index('audit_events_entity_idx').on(t.tenantId, t.entity, t.entityId),
}))

/* ──────────────────────────────────────────────── événements de statistiques */

export const siteEvents = pgTable('site_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** 'pageview' | 'whatsapp_click' | 'catalogue_view' | 'order_start' | 'call_click' */
  event: varchar('event', { length: 48 }).notNull(),
  path: text('path'),
  meta: jsonb('meta').notNull().default({}),
  /** Jour en UTC — permet l'agrégation sans lire chaque ligne. */
  day: varchar('day', { length: 10 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantDayIdx: index('site_events_tenant_day_idx').on(t.tenantId, t.day, t.event),
}))

/* ────────────────────────────────────────────────────────────────── relations */

export const productsRelations = {
  tenant:   { fields: [products.tenantId],   references: [tenants.id] },
  category: { fields: [products.categoryId], references: [categories.id] },
}

export type Tenant = typeof tenants.$inferSelect
export type NewTenant = typeof tenants.$inferInsert
export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type Banner = typeof banners.$inferSelect
export type Faq = typeof faqs.$inferSelect
export type BlogPost = typeof blogPosts.$inferSelect
export type SiteSettings = typeof siteSettings.$inferSelect
export type Lead = typeof leads.$inferSelect
export type MediaAsset = typeof media.$inferSelect
export type AuditEvent = typeof auditEvents.$inferSelect
export type Category = typeof categories.$inferSelect