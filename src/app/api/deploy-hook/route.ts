import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { resolveSession } from '@/core/session'

export const dynamic = 'force-dynamic'

/**
 * POST /api/deploy-hook — déclenche la reconstruction d'un site client.
 *
 * C'est ce qui rend le mode `build` utilisable : le commerçant enregistre un
 * produit, le site se reconstruit, le contenu est à jour. Sans cela il
 * faudrait redéployer à la main, et personne ne le ferait.
 *
 * SÉCURITÉ — deux verrous, tous deux obligatoires :
 *   1. session superadmin ou propriétaire du tenant ;
 *   2. le secret de déploiement, sinon n'importe qui holding la page peut
 *      provoquer des reconstructions en boucle — un vecteur de DoS gratuit.
 *
 * Le secret est comparé à temps constant : une comparaison `===` sur un
 * secret laisse fuiter son contenu par mesure du temps.
 */

const TIMING_SAFE_MIN_LENGTH = 32

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export async function POST(req: Request) {
  // ── Verrou 2 : secret de déploiement ──────────────────────────────────
  const expected = process.env.DEPLOY_HOOK_SECRET
  const provided = req.headers.get('x-deploy-secret') ?? ''

  if (!expected) {
    return NextResponse.json(
      { error: 'DEPLOY_HOOK_SECRET non configuré côté admin.' }, { status: 500 },
    )
  }
  if (expected.length < TIMING_SAFE_MIN_LENGTH || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Secret invalide.' }, { status: 401 })
  }

  // ── Verrou 1 : session et droits ─────────────────────────────────────
  const h = await headers()   // Next 15 : headers() est une promesse
  const host = (h.get('x-forwarded-host') ?? '').split(':')[0]
  const session = await resolveSession(host.split('.')[0])
  if (!session) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { slug?: string }
  const slug = body.slug ?? session.tenant.slug

  // Un superadmin peut cibler un autre tenant ; sinon, seulement le sien.
  if (!session.isSuperAdmin && slug !== session.tenant.slug) {
    return NextResponse.json({ error: 'Tenant non autorisé' }, { status: 403 })
  }

  const hook = process.env[`DEPLOY_HOOK_${slug.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`]
    ?? process.env.DEPLOY_HOOK_DEFAULT

  if (!hook) {
    return NextResponse.json(
      { error: `Aucun deploy hook configuré pour « ${slug} ».` }, { status: 501 },
    )
  }

  try {
    const res = await fetch(hook, { method: 'POST' })
    if (!res.ok) {
      return NextResponse.json(
        { error: `Le service de déploiement a répondu ${res.status}.` },
        { status: 502 },
      )
    }
    return NextResponse.json({ ok: true, slug, triggered: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Déclenchement impossible' },
      { status: 502 },
    )
  }
}