#!/usr/bin/env node
/**
 * bootstrap.mjs — Crée le premier superadmin et le tenant Continental.
 *
 * Se lance UNE fois, quand la base existe et que les migrations ont été
 * appliquées. Évite de saisir du SQL à la main dans un client SQL.
 *
 *   export DATABASE_URL=postgres://atelier_app:motdepasse@postgres:5432/atelier
 *   export BOOTSTRAP_EMAIL=vous@votredomaine.sn
 *   export BOOTSTRAP_PASSWORD='un-mot-de-passe-long-et-aleatoire'
 *   node bootstrap.mjs
 *
 * Le rôle applicatif `atelier_app` suffit : il écrit dans user/member/
 * organization, qui ne portent pas de RLS.
 */

import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

const {
  DATABASE_URL,
  BOOTSTRAP_EMAIL,
  BOOTSTRAP_PASSWORD,
  BOOTSTRAP_TENANT = 'continental',
  BOOTSTRAP_TENANT_NAME = 'Continental®',
} = process.env

const missing = ['DATABASE_URL', 'BOOTSTRAP_EMAIL', 'BOOTSTRAP_PASSWORD']
  .filter((k) => !process.env[k])

if (missing.length) {
  console.error(`✗ Variables manquantes : ${missing.join(', ')}`)
  process.exit(1)
}

if (BOOTSTRAP_PASSWORD.length < 12) {
  console.error('✗ BOOTSTRAP_PASSWORD : 12 caractères minimum.')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false })

/**
 * Hash compatible Better Auth (scrypt). On délègue au serveur Better Auth
 * plutôt que de réimplémenter : une implémentation divergente produirait un
 * mot de passe que l'authentification refuse ensuite, sans raison visible.
 */
async function hashPassword() {
  const { hashPassword: betterHash } = await import(
    'better-auth/crypto'
  )
  return betterHash(BOOTSTRAP_PASSWORD)
}

const now = new Date().toISOString()

try {
  const passwordHash = await hashPassword()

  await sql.begin(async (tx) => {
    // ── Tenant ────────────────────────────────────────────────────────
    const [tenant] = await tx`
      INSERT INTO tenants (slug, name, status, locale, modules, theme)
      VALUES (
        ${BOOTSTRAP_TENANT}, ${BOOTSTRAP_TENANT_NAME}, 'active', 'fr',
        '[]'::jsonb,
        ${JSON.stringify({
          preset: 'default',
          label: BOOTSTRAP_TENANT_NAME,
          tagline: 'Administration du site',
        })}::jsonb
      )
      ON CONFLICT (slug) DO UPDATE SET updated_at = now()
      RETURNING id::text
    `
    const tenantId = tenant.id

    // ── Organisation : le rattachement utilisateur → site ───────────────
    const orgId = randomUUID()
    await tx`
      INSERT INTO organization (id, name, slug, member_limit)
      VALUES (${orgId}, ${BOOTSTRAP_TENANT_NAME}, ${BOOTSTRAP_TENANT}, 5)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    `

    // ── Utilisateur superadmin ────────────────────────────────────────
    const userId = randomUUID()
    await tx`
      INSERT INTO "user" (id, name, email, email_verified, is_super_admin, created_at, updated_at)
      VALUES (${userId}, 'Atelier', ${BOOTSTRAP_EMAIL.toLowerCase()}, true, true,
              ${now}, ${now})
      ON CONFLICT (email) DO UPDATE
        SET is_super_admin = true, updated_at = now()
    `

    // ── Compte mot de passe ────────────────────────────────────────────
    const accountId = randomUUID()
    await tx`
      INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
      VALUES (${accountId}, ${userId}, 'credential', ${userId}, ${passwordHash},
              ${now}, ${now})
      ON CONFLICT (provider_id, account_id) DO UPDATE SET password = EXCLUDED.password
    `

    // ── Membre de l'organisation ───────────────────────────────────────
    await tx`
      INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (${randomUUID()}, ${orgId}, ${userId}, 'owner', ${now})
      ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'
    `

    // ── Trace : ce bootstrap EST un événement d'audit ──────────────────
    await tx`
      INSERT INTO audit_events
        (tenant_id, actor_id, actor_email, entity, action, after)
      VALUES (${tenantId}, ${userId}, ${BOOTSTRAP_EMAIL},
              'tenant', 'create',
              ${JSON.stringify({ slug: BOOTSTRAP_TENANT, bootstrapped: true })}::jsonb)
    `
  })

  console.log(`\n✓ Bootstrap terminé.

  Superadmin : ${BOOTSTRAP_EMAIL}
  Tenant     : ${BOOTSTRAP_TENANT} (${BOOTSTRAP_TENANT_NAME})
  Modules    : AUCUN — à cocher dans /superadmin

  Aucun module n'est activé : le choix vous revient.

  Étape suivante :
    node ../continental-website/scripts/…  ou
    cd ../atelier-admin && node scripts/seed-continental.mjs

  Le mot de passe n'est pas affiché : il ne l'est stocké que haché.
  Si vous l'oubliez, relancez ce script avec un nouveau mot de passe.
`)
} catch (err) {
  console.error('\n✗ Échec du bootstrap :', err.message)
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 }).catch(() => {})
}