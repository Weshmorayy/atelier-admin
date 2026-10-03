'use server'

/**
 * actions-site.ts — Réglages du site : contacts, réseaux, horaires, SEO.
 *
 * Module `settings`, permission `manage-settings` — RÉSERVÉE À L'OWNER.
 * Un manager ou un éditeur ne peut pas changer le numéro de téléphone : c'est
 * une décision commerciale, pas une retouche de contenu. La politique RLS
 * `settings_wri` l'interdit également au niveau base, donc même un contournement
 * de l'interface ne passe pas.
 */

import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { withTenant } from '@/db'
import { resolveSession } from '@/core/session'
import { permissionAllowed } from '@/core/modules'
import { withAudit } from '@/core/audit'
import { ForbiddenError, toMessage } from '@/core/errors'

/**
 * Les horaires sont trois chaînes libres : `siteConfig.hours` de Continental
 * utilise exactement ce modèle. Valider « ouvert » / « fermé » /
 * « 8h – 20h » n'apporterait rien et compliquerait la migration.
 */
const settingsSchema = z.object({
  contact: z.object({
    phone: z.string().max(40).optional().default(''),
    whatsapp: z.string().max(40).optional().default(''),
    email: z.string().max(160).optional().default(''),
    address: z.string().max(300).optional().default(''),
    city: z.string().max(80).optional().default(''),
    country: z.string().max(80).optional().default(''),
  }).prefault({}),
  social: z.object({
    facebook: z.string().max(200).optional().default(''),
    instagram: z.string().max(200).optional().default(''),
    tiktok: z.string().max(200).optional().default(''),
  }).prefault({}),
  hours: z.object({
    weekdays: z.string().max(80).optional().default(''),
    saturday: z.string().max(80).optional().default(''),
    sunday: z.string().max(80).optional().default(''),
  }).prefault({}),
  seo: z.object({
    title: z.string().max(120).optional().default(''),
    description: z.string().max(400).optional().default(''),
  }).prefault({}),
})

export type SettingsResult =
  | { ok: true }
  | { ok: false; error: string }

export async function saveSiteSettings(
  slug: string,
  input: unknown,
): Promise<SettingsResult> {
  const session = await resolveSession(slug)
  if (!session) throw new ForbiddenError()
  if (!permissionAllowed(session.tenant.modules, 'settings', 'manage-settings')) {
    throw new ForbiddenError()
  }

  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }

  const data = parsed.data
  const h = await headers()

  try {
    await withTenant(session.ctx, (tx) =>
      withAudit(
        tx,
        {
          tenantId: session.ctx.tenantId,
          userId: session.user.id,
          userEmail: session.user.email,
          ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          userAgent: h.get('user-agent'),
        },
        {
          entity: 'site_settings',
          action: 'update',
          readBefore: async (t) => {
            const rows = await t.execute(sql`
              SELECT row_to_json(s) FROM site_settings s
               WHERE s.tenant_id = ${session.ctx.tenantId} LIMIT 1
            `)
            return ((rows as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>
          },
        },
        async (t) => {
          await t.execute(sql`
            INSERT INTO site_settings
              (tenant_id, contact, social, hours, seo)
            VALUES (
              ${session.ctx.tenantId},
              ${JSON.stringify(data.contact)}::jsonb,
              ${JSON.stringify(data.social)}::jsonb,
              ${JSON.stringify(data.hours)}::jsonb,
              ${JSON.stringify(data.seo)}::jsonb
            )
            ON CONFLICT (tenant_id) DO UPDATE SET
              contact   = EXCLUDED.contact,
              social    = EXCLUDED.social,
              hours     = EXCLUDED.hours,
              seo       = EXCLUDED.seo,
              updated_at= now()
          `)
          const after = await t.execute(sql`
            SELECT row_to_json(s) FROM site_settings s
             WHERE s.tenant_id = ${session.ctx.tenantId} LIMIT 1
          `)
          return ((after as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>
        },
      ),
    )

    revalidatePath(`/admin/${slug}/settings`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: toMessage(err) }
  }
}