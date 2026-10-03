import { NextResponse, type NextRequest } from 'next/server'

/**
 * Résolution du tenant pour la coquille d'administration.
 *
 * `admin/layout.tsx` ne reçoit PAS les paramètres de route : en App Router,
 * un layout parent ne voit pas le segment dynamique de l'enfant. Il ne pouvait
 * donc connaître le slug que par le sous-domaine, ce qui vide l'écran de sa
 * navigation dès que l'on n'utilise pas de sous-domaine — c'est-à-dire en
 * local, et pour tout déploiement qui n'a pas encore ses domaines.
 *
 * Le middleware remet le slug du chemin dans un en-tête de requête. Il ne
 * s'agit PAS d'une source d'autorisation : le slug reste une clé de
 * recherche, et l'accès est accordé par la ligne `member` (core/session.ts).
 * Un en-tête forgé ne fait donc rien de plus qu'un slug dans l'URL.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const requestHeaders = new Headers(req.headers)

  // `/admin/continental/products` → `continental`
  // `/admin` seul n'a pas de slug : on retombe alors sur le sous-domaine.
  const fromPath = pathname.match(/^\/admin\/([^/]+)/)?.[1]

  const host = (
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  ).split(':')[0]
  const fromHost = host.split('.')[0]

  const tenant = fromPath ?? fromHost

  // Un slug ne peut pas contenir de caractère exotique : il sert de clé de
  // recherche mais reste validé par la base.
  if (tenant && /^[a-z0-9][a-z0-9-]{0,62}$/i.test(tenant)) {
    requestHeaders.set('x-atelier-tenant', tenant)
  }

  // Chemin courant : permet au layout de marquer l'entrée active du menu,
  // lui aussi privé des params de route.
  requestHeaders.set('x-atelier-path', pathname)

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/admin/:path*', '/superadmin/:path*'],
}