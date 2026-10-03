/**
 * media.ts — Téléversement vers le stockage objet (MinIO / S3-compatible).
 *
 * Modèle : URL pré-signée. Le navigateur envoie le fichier DIRECTEMENT au
 * stockage ; les octets ne traversent jamais le serveur Next.js. Le serveur ne
 * fait que signer et enregistrer.
 *
 * Sécurité de la clé : `crypto.randomUUID()` et JAMAIS le nom d'origine.
 * Un nom de fichier client contient des espaces, des accents, parfois des
 * chevauchements de chemin. Le réécrire « proprement » reste une source de
 * traversée de répertoire et de collision ; l'aléatoire l'élimine.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/** Types acceptés. Le type est validé ET vérifié côté serveur. */
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml'])

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 Mo

const uploadRequest = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
  /** Préfixe logique, ex. 'products' ou 'banners'. */
  folder: z.enum(['products', 'banners', 'pages', 'blog', 'media', 'brand']).default('media'),
})

export interface PresignedUpload {
  uploadUrl: string
  publicUrl: string
  key: string
  expiresIn: number
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} manquant — stockage média non configuré`)
  return v
}

/**
 * Extension déduite du TYPE MIME déclaré, jamais du nom de fichier.
 * Un client peut envoyer `photo.php` en `image/png` : on garderait `.php`,
 * et un CDN mal configuré pourrait l'exécuter.
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

/** Normalise un segment de dossier : ni `/`, ni `..`, ni vide. */
function safeSegment(input: string): string {
  const s = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-')
  return s.replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'fichier'
}

export function buildObjectKey(tenantSlug: string, folder: string, contentType: string): string {
  const ext = EXT_BY_MIME[contentType] ?? 'bin'
  return `${safeSegment(tenantSlug)}/${folder}/${randomUUID()}.${ext}`
}

/**
 * Génère une URL pré-signée PUT.
 *
 * Nécessite deux points d'accès distincts (c'est une contrainte S3 réelle) :
 *  - `S3_*`          → usage serveur, pour signer et supprimer
 *  - `S3_PUBLIC_URL` → base publique des fichiers servis au navigateur
 * Le `S3_ENDPOINT` interne (`http://minio:9000`) n'est pas résolvable depuis
 * un navigateur : signer l'upload avec lui produirait une URL morte.
 */
/**
 * @param tenantSlug issu de la session résolue côté serveur — JAMAIS de
 *        l'entrée du client, sinon un tenant pourrait écrire dans le dossier
 *        d'un autre.
 */
export async function createPresignedUpload(
  tenantSlug: string,
  input: unknown,
): Promise<PresignedUpload> {
  const data = uploadRequest.parse(input)

  if (!ALLOWED.has(data.contentType)) {
    throw new Error(`Type de fichier non autorisé : ${data.contentType}`)
  }

  const bucket = required('S3_BUCKET')
  const region = process.env.S3_REGION ?? 'us-east-1'
  const endpoint = required('S3_ENDPOINT')
  const publicBase = required('S3_PUBLIC_URL').replace(/\/+$/, '')
  const key = buildObjectKey(tenantSlug, data.folder, data.contentType)

  // Signature AWS v4 minimale, sans dépendance : HMAC-SHA256 en cascade.
  const expiresIn = 900 // 15 min
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(endpoint).host
  const canonicalUri = `/${bucket}/${key}`
  const signedHeaders = 'host'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    'PUT', canonicalUri, '',
    `host:${host}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = await hmac(`AWS4${required('S3_SECRET_ACCESS_KEY')}`, dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = (await hmac(kSigning, stringToSign)).toString('hex')

  // L'endpoint public sert à l'upload ; le nom d'hôte doit être signé.
  // La signature doit porter sur l'hôte réellement utilisé dans l'URL.
  // On signe donc pour `host`, le même qui figure dans l'URL construite.
  const uploadUrl =
    `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}` +
    `?X-Amz-Algorithm=AWS4-HMAC-SHA256` +
    `&X-Amz-Credential=${encodeURIComponent(`${required('S3_ACCESS_KEY_ID')}/${scope}`)}` +
    `&X-Amz-Date=${amzDate}` +
    `&X-Amz-Expires=${expiresIn}` +
    `&X-Amz-SignedHeaders=${signedHeaders}` +
    `&X-Amz-Signature=${signature}`

  return {
    uploadUrl,
    publicUrl: `${publicBase}/${key}`,
    key,
    expiresIn,
  }
}

/* ─────────────────────────────────────────────────────────────── crypto ── */

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(digest).toString('hex')
}

async function hmac(key: string | Uint8Array, data: string): Promise<Buffer> {
  const k = typeof key === 'string' ? Buffer.from(key, 'utf8') : Buffer.from(key)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return Buffer.from(sig)
}

/** Constructeurs exposés pour les tests. */
export const _internal = { safeSegment, sha256Hex, hmac, buildObjectKey }