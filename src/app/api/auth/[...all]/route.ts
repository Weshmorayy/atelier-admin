import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/core/auth'

/**
 * Le pont Next.js de Better Auth. `toNextJsHandler` adaptateur la fonction
 * `auth.handler` aux conventions App Router (Request/Response web).
 */
export const { GET, POST } = toNextJsHandler(auth)
