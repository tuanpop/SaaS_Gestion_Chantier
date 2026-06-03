/** @type {import('next').NextConfig} */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

// CSP: unsafe-inline requis pour Tailwind. unsafe-eval requis par Next.js HMR en dev.
// TODO: durcir avec nonces en production post-pilote.
const IS_DEV = process.env.NODE_ENV !== 'production'
const scriptSrc = IS_DEV
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'"
// Google Fonts CSS + Supabase local (127.0.0.1:54321) en dev
const styleSrc = "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
const fontSrc = "font-src 'self' https://fonts.gstatic.com"
const connectSrcParts = ["'self'", SUPABASE_URL, 'https://api.anthropic.com']
if (IS_DEV) {
  // En dev, accepter HMR websocket + Supabase local
  connectSrcParts.push('ws://localhost:*', 'http://127.0.0.1:*', 'http://localhost:*')
}
const ContentSecurityPolicy = [
  "default-src 'self'",
  scriptSrc,
  styleSrc,
  "img-src 'self' data: blob:",
  fontSrc,
  `connect-src ${connectSrcParts.filter(Boolean).join(' ')}`,
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },
  // C-06 (CORS) : restreint à l'URL du projet — jamais '*'
  {
    key: 'Access-Control-Allow-Origin',
    value: APP_URL,
  },
]

const nextConfig = {
  // fetch() = no-store par défaut (Next.js 15 breaking change)
  // Opt-in cache explicite si nécessaire via { next: { revalidate: N } }

  // SECURITY: K2.5-I-05 — ne pas exposer les source maps en production
  productionBrowserSourceMaps: false,

  // Output standalone : génère .next/standalone/ pour Docker (Tanjiro Dockerfile multi-stage)
  output: 'standalone',

  // Templates emails — inclure dans le build standalone pour que fs.readFileSync() fonctionne
  // en production (Next.js output:standalone ne trace que les fichiers importés statiquement).
  // Pattern : toutes les routes API peuvent lire les templates.
  outputFileTracingIncludes: {
    '/api/**/*': ['./templates/**/*'],
  },

  // Packages dont le bundling webpack casse le runtime — externalise (Next.js charge
  // depuis node_modules en runtime via outputFileTracingIncludes Next.js standalone).
  // - pino + pino-pretty + thread-stream : worker thread mal bundlé
  // Note D-054 : ioredis retire de serverExternalPackages (lib/redis.ts supprimee, D-054 pivot Postgres)
  serverExternalPackages: ['pino', 'pino-pretty', 'thread-stream'],

  async headers() {
    return [
      {
        // Appliquer les security headers sur toutes les routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },

  // Bloc explicite pour éviter d'exposer des variables serveur côté client
  serverRuntimeConfig: {
    // Variables serveur uniquement — jamais en NEXT_PUBLIC_
  },

  publicRuntimeConfig: {
    // Uniquement les variables NEXT_PUBLIC_ ici
  },
}

module.exports = nextConfig
