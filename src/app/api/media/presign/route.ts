import { NextResponse } from 'next/server'
import { resolveSession } from '@/core/session'
import { createPresignedUpload } from '@/core/media'
import { toMessage } from '@/core/errors'

export const dynamic = 'force-dynamic'

/**
 * POST /api/media/presign — URL d'upload signée pour un tenant.
 *
 * Le slug du tenant vient de la SESSION, jamais du corps de la requête :
 * c'est ce qui empêche un client d'écrire dans le dossier d'un autre tenant.
 */
export async function POST(req: Request) {
  try {
    const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '')
      .split(':')[0]
    const session = await resolveSession(host.split('.')[0])
    if (!session) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await req.json()
    const result = await createPresignedUpload(session.tenant.slug, body)

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: toMessage(err) }, { status: 400 })
  }
}
