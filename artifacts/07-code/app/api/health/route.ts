import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

// ============================================================
// GET /api/health — Health check
// Route toujours publique (voir middleware.ts PUBLIC_API_ROUTES)
// Utilisée par le load balancer et le monitoring (architecture.md §Checklist Sprint 1)
// ============================================================

export async function GET() {
  try {
    logger.debug('Health check requested')

    return NextResponse.json(
      {
        data: {
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: process.env['npm_package_version'] ?? 'unknown',
        },
      },
      { status: 200 },
    )
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Health check failed',
    )

    return NextResponse.json(
      {
        data: {
          status: 'error',
          timestamp: new Date().toISOString(),
        },
      },
      { status: 503 },
    )
  }
}
