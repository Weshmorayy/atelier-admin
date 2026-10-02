/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // L'admin n'est jamais exporté en statique : il est authentifié et dynamique.
}

export default nextConfig
