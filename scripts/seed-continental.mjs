#!/usr/bin/env node
/**
 * seed-continental.mjs — Génère le SQL d'amorçage du tenant Continental.
 *
 * Le catalogue est lu depuis le SITE (`src/data/products.ts`), pas recopié à la
 * main : le seed ne peut pas diverger de ce que le site affiche aujourd'hui.
 * Rejouer le script après une refonte du catalogue le remet à jour.
 *
 *   node seed-continental.mjs > drizzle/seed_continental.sql
 *
 * Appliqué ensuite via la Management API (voir .ops/), comme toute migration.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SITE = resolve(HERE, '../../continental-website/src/data/products.ts')

/* ── Lecture du catalogue depuis le site ─────────────────────────────────── */

const src = readFileSync(SITE, 'utf8')

const block = src.match(/export const products:\s*Product\[\]\s*=\s*\[([\s\S]*?)\n\]\s*$/m)
if (!block) {
  console.error('✗ Impossible de lire products.ts — la forme attendue a changé.')
  process.exit(1)
}

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const arr = (v) => `ARRAY[${(v ?? []).map(q).join(', ')}]::text[]`
const json = (v) => `${JSON.stringify(v ?? {}).replace(/'/g, "''")}`

/** Découpe le tableau d'objets en enregistrements. */
const records = block[1]
  .split(/\n\s{4}\},\s*\n/)
  .map((r) => r.trim())
  .filter(Boolean)

function field(record, name, fallback = null) {
  const m = record.match(new RegExp(`\\b${name}:\\s*([^,\\n]+)`))
  if (!m) return fallback
  let v = m[1].trim().replace(/,$/, '')
  if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/\\'/g, "'")
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?[\d.]+$/.test(v)) return Number(v)
  return v
}

const rows = records.map((r) => {
  const slug = field(r, 'slug')
  const name = field(r, 'name')
  const price = field(r, 'price', 0)
  const image = field(r, 'image')
  const badge = field(r, 'badge')
  const category = field(r, 'category', 'ventilateur-pied')
  const inStock = field(r, 'inStock', true)
  const ref = field(r, 'ref')

  // Les specs du site deviennent le champ libre de l'admin.
  const specs = { ref, ...(ref ? { 'Référence': ref } : {}) }

  return `  ('continental', ${q(slug)}, ${q(name)}, ${price}, ${q(image)}, ${q(badge)},
   ${q(category)}, ${inStock ? 'true' : 'false'}, ${q(json(specs))}::jsonb)`
})

const categories = [
  ['ventilateur-pied', 'Ventilateurs sur pied'],
  ['ventilateur-sol', 'Brasseurs d\'air & Sol'],
  ['climatiseur', 'Climatiseurs Inverter'],
]

const modules = ['settings', 'categories', 'products', 'banners', 'media', 'leads']

/* ── Émission du SQL ────────────────────────────────────────────────────── */

const sql = `-- Généré par seed-continental.mjs — NE PAS ÉDITER À LA MAIN.
-- Source : continental-website/src/data/products.ts
-- ${rows.length} produit(s)

BEGIN;

-- Tenant
INSERT INTO tenants (slug, name, status, locale, modules, theme)
VALUES (
  'continental',
  'Continental®',
  'active',
  'fr',
  ${q(JSON.stringify(modules))}::jsonb,
  ${q(JSON.stringify({
    preset: 'default',
    label: 'Continental',
    logo: '/brand/logo-light.png',
    tagline: 'Vente & SAV — Dakar',
  }))}::jsonb
)
ON CONFLICT (slug) DO UPDATE
  SET modules = EXCLUDED.modules,
      theme  = EXCLUDED.theme,
      updated_at = now();

-- Catégories
INSERT INTO categories (tenant_id, slug, label, position)
SELECT t.id, c.slug, c.label, c.pos
  FROM tenants t
  CROSS JOIN (VALUES
    ${categories.map(([slug, label], i) => `(${q(slug)}, ${q(label)}, ${i})`).join(',\n     ')}
  ) AS c(slug, label, pos)
 WHERE t.slug = 'continental'
ON CONFLICT (tenant_id, slug) DO UPDATE
  SET label = EXCLUDED.label, position = EXCLUDED.position;

-- Produits
INSERT INTO products
  (tenant_id, slug, name, price, image, badge, category_label, in_stock,
   is_active, specs, features, published_at)
SELECT t.id, p.slug, p.name, p.price, p.image, p.badge, p.category_label,
       p.in_stock, true, p.specs, ARRAY[]::text[], now()
  FROM tenants t
  CROSS JOIN (VALUES
     ${rows.join(',\n     ')}
  ) AS p(slug, name, price, image, badge, category_label, in_stock, specs)
 WHERE t.slug = 'continental'
ON CONFLICT (tenant_id, slug) DO UPDATE
  SET name    = EXCLUDED.name,
      price   = EXCLUDED.price,
      image   = EXCLUDED.image,
      badge   = EXCLUDED.badge,
      specs   = EXCLUDED.specs,
      updated_at = now();

COMMIT;
`

process.stdout.write(sql)
console.error(`✓ ${rows.length} produit(s), ${categories.length} catégorie(s) — écrit sur stdout.`)