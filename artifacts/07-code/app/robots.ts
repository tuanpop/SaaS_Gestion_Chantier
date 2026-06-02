// app/robots.ts
// SECURITY: K2.5-CR-02 contrôle 4 — preview secondaire ne doit pas être indexée
// D-2.5-027 (amendée HITL #5 F002)

import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXT_PUBLIC_ENV === 'preview-ui') {
    return { rules: { userAgent: '*', disallow: '/' } }
  }
  return { rules: { userAgent: '*', allow: '/' } }
}
