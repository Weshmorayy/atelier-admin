/**
 * audit.ts — Écriture du journal d'audit DANS la mutation.
 *
 * Règle : l'audit n'est jamais une écriture séparée. Si elle l'était, un
 * commit réussi sans trace (ou l'inverse) rendrait le journal non fiable —
 * précisément la propriété pour laquelle on le tient.
 *
 * `auditEvents` est en append-only : un trigger rejette UPDATE/DELETE/TRUNCATE
 * au niveau PostgreSQL, donc même un bug applicatif ne peut pas l'altérer.
 */

import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@/db/schema'
import type { Role } from '@/db'

export interface AuditMeta {
  tenantId: string
  userId?: string
  userEmail?: string
  role?: Role
  ip?: string
  userAgent?: string
}

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'login' | 'logout' | 'export' | 'import'

/** Champs jamais journalisés en clair. */
const REDACT = new Set([
  'password', 'passwordHash', 'token', 'secret', 'apiKey', 'serviceRoleKey',
  'sessionToken', 'otp', 'mfaSecret',
])

/**
 * Copie assainie : retire les secrets et tronque les gros blobs.
 * Un `before/after` complet d'un produit avec 40 images en base n'a aucun
 * intérêt et alourdit la table.
 */
export function sanitize<T>(value: T, maxLength = 4000): unknown {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
  if (typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT.has(k)) { out[k] = '[redacted]'; continue }
    out[k] = sanitize(v, maxLength)
  }
  return out
}

/**
 * Diff minimal entre deux versions d'une entité : uniquement les champs
 * réellement modifiés. Un `before/after` complet est illisible et peu utile.
 */
export function diff(before: unknown, after: unknown): { before: unknown; after: unknown } {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return { before: sanitize(before), after: sanitize(after) }
  }

  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]

  const bPart: Record<string, unknown> = {}
  const aPart: Record<string, unknown> = {}
  let changed = false

  for (const k of keys) {
    if (k === 'updatedAt' || k === 'updated_at') continue
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
      bPart[k] = b[k]
      aPart[k] = a[k]
      changed = true
    }
  }

  return changed
    ? { before: sanitize(bPart), after: sanitize(aPart) }
    : { before: null, after: null }
}

/**
 * Exécute une mutation et journalise dans la MÊME transaction.
 *
 * @param fn reçoit la transaction ; toute écriture y passe par `tx`.
 * @param entity  table concernée, ex. 'product'
 * @param action  action journalisée
 * @param getEntity lit l'état avant pour produire un diff (optionnel)
 */
export async function withAudit<T>(
  tx: PostgresJsDatabase<typeof schema>,
  meta: AuditMeta,
  params: {
    entity: string
    entityId?: string | null
    action: AuditAction
    before?: unknown
    after?: unknown
  },
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  const result = await fn(tx)

  const { before, after } =
    params.action === 'update' || params.action === 'restore'
      ? diff(params.before, params.after ?? result)
      : { before: sanitize(params.before ?? null), after: sanitize(params.after ?? null) }

  await tx.execute(sql`
    INSERT INTO audit_events
      (tenant_id, actor_id, actor_email, entity, entity_id, action,
       before, after, ip, user_agent)
    VALUES (
      ${meta.tenantId},
      ${meta.userId ?? null},
      ${meta.userEmail ?? null},
      ${params.entity},
      ${params.entityId ?? null},
      ${params.action},
      ${before === null ? null : JSON.stringify(before)}::jsonb,
      ${after === null ? null : JSON.stringify(after)}::jsonb,
      ${meta.ip ?? null},
      ${meta.userAgent ?? null}
    )
  `)

  return result
}