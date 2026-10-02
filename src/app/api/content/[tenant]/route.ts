import { NextResponse } from 'next/server'
import { getSiteContent } from '@/core/content'

/**
 * GET /api/content/[tenant]
 *
 * Contenu public d'un site client, filtré par modules actifs.
 *
 * Utilisé par les sites en mode `build` (au moment du build) comme en mode
 * `live` (à chaque requête). Aucune authentification : c'est du contenu
 * public. Ce qui n'est pas publié n'est jamais renvoyé — la sélection se fait
 * dans `getSiteContent`, pas ici.
 *
 * La réponse est immuable pendant 60 s : le build d'un site client ne doit pas
 * martyriser la base.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant } = await params

  try {
    const content = await getSiteContent(tenant)

    return NextResponse.json(content, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    const notFound = message.includes('introuvable')

    return NextResponse.json(
      { error: notFound ? 'Tenant introuvable' : 'Erreur de lecture du contenu' },
      { status: notFound ? 404 : 500 },
    )
  }
}