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

/**
 * Extraction du tableau par COMPTAGE DE CROCHETS.
 *
 * Un regex non-greedy s'arrête au premier `]` en début de ligne — c'est-à-dire
 * au premier tableau imbriqué, pas à la fin de `products`. C'est ce qui
 * produisait des lignes corrompues. Le comptage suit réellement l'imbrication.
 */
function extractArray(source, marker) {
  const startAt = source.indexOf(marker)
  if (startAt === -1) throw new Error(`Marqueur introuvable : ${marker}`)

  // On cherche le `[` APRÈS le `=` d'initialisation : sinon on tombe sur
  // l'annotation de type `Product[]`, et le script lit « [] ».
  const assignAt = source.indexOf('=', startAt)
  if (assignAt === -1) throw new Error(`Affectation introuvable après ${marker}`)
  const open = source.indexOf('[', assignAt)
  let depth = 0
  let quote = null

  for (let i = open; i < source.length; i++) {
    const ch = source[i]

    if (quote) {
      if (ch === '\\') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  throw new Error('Crochets non équilibrés')
}

const arrayText = extractArray(src, 'export const products')

// Le fichier est du code local maîtrisé : on l'évalue plutôt que de réécrire
// un analyseur de TypeScript. Les clés non-quotées du format objet sont
// valides en JavaScript.
const products = new Function(`return ${arrayText}`)()

if (!Array.isArray(products) || products.length === 0) {
  throw new Error('Aucun produit extrait.')
}

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const json = (v) => `${JSON.stringify(v ?? {}).replace(/'/g, "''")}`

const rows = products.map((p, i) => {
  const specs = { ...(p.ref ? { 'Référence': p.ref } : {}), ...(p.specs ?? {}) }
  const cells = [
    q(p.slug || 'produit-' + (i + 1)),
    q(p.name),
    String(Number(p.price) || 0),
    q(p.image),
    q(p.badge),
    p.inStock === false ? 'false' : 'true',
    q(json(specs)) + '::jsonb',
    q(p.category || 'ventilateur-pied'),
  ]
  return '  (' + cells.join(', ') + ')'
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

-- Les seeds s'exécutent comme propriétaire des tables. Or FORCE ROW LEVEL
-- SECURITY soumet AUSSI le propriétaire aux politiques — c'est voulu, pour que
-- le propriétaire ne puisse pas contourner l'isolation. Un seed a donc besoin
-- d'une porte explicite, levée ici puis refermée dans le même transaction.
ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE categories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE products NO FORCE ROW LEVEL SECURITY;

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
  (tenant_id, slug, name, price, image, badge, in_stock,
   is_active, specs, features, category_id, published_at)
SELECT t.id, p.slug, p.name, p.price, p.image, p.badge,
       p.in_stock, true, p.specs, '[]'::jsonb,
       -- La catégorie se résout ICI : dans un ON CONFLICT, seules EXCLUDED et
       -- la table cible sont visibles, pas les alias du FROM.
       (SELECT c.id FROM categories c
         WHERE c.tenant_id = t.id AND c.slug = p.category_slug) AS category_id,
       now()
  FROM tenants t
  CROSS JOIN (VALUES
     ${rows.join(',\n     ')}
  ) AS p(slug, name, price, image, badge, in_stock, specs, category_slug)
 WHERE t.slug = 'continental'
ON CONFLICT (tenant_id, slug) DO UPDATE
  SET name    = EXCLUDED.name,
      price   = EXCLUDED.price,
      image   = EXCLUDED.image,
      badge   = EXCLUDED.badge,
      specs   = EXCLUDED.specs,
      updated_at = now();

-- On referme immédiatement : dès la sortie de cette transaction, l'isolation
-- est de nouveau garantie, même si le seed a échoué entre-temps.
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

COMMIT;
`

process.stdout.write(sql)
console.error(`✓ ${rows.length} produit(s), ${categories.length} catégorie(s) — écrit sur stdout.`)