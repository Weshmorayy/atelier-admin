/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `postgres` est un pilote Node : il utilise `net` et `tls`. Sans cette
  // ligne, le bundler tente de l'embarquer et échoue sur ces modules natifs.
  serverExternalPackages: ['postgres'],
  // L'admin n'est jamais exporté en statique : il est authentifié et dynamique.
}

export default nextConfig
