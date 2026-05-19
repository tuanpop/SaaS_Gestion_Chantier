// ============================================================
// Email layout — loader + renderer + Resend sender
// Templates HTML charges depuis templates/emails/ (cf README)
// Miroir de C:\_Git\AdTomate\src\lib\notifications\email-layout.ts
// Branding : ClawBTP (Outfit 800 + Public Sans, orange #F97316, bleu #163958)
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '@/lib/logger'

const RESEND_URL = 'https://api.resend.com/emails'
const TEMPLATES_DIR = join(process.cwd(), 'templates', 'emails')

// Cache des templates lus depuis le disque (lecture unique par template par process)
const templateCache = new Map<string, string>()

function loadTemplate(relativePath: string): string {
  const cached = templateCache.get(relativePath)
  if (cached) return cached
  const fullPath = join(TEMPLATES_DIR, relativePath)
  try {
    const content = readFileSync(fullPath, 'utf-8')
    templateCache.set(relativePath, content)
    return content
  } catch (err) {
    logger.warn({ relativePath, err }, '[email] Template not found — returning empty string')
    return ''
  }
}

// Substitution {{KEY}} -> value.
// Les valeurs ne sont PAS echappees ici :
// l'appelant doit escapeHtml() les inputs user avant de les passer.
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

// ── Public helpers ──

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Bloc info encadre (details, mises en avant...) — HTML pret a injecter dans un body fragment.
 * Fond #FFF3E8, barre gauche orange #F97316 3px — branding ClawBTP.
 */
export function buildInfoBox(innerHtml: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;">
  <tr><td style="background-color:#FFF3E8;border-left:3px solid #F97316;padding:18px 22px;font-family:'Public Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#222222;">
    ${innerHtml}
  </td></tr>
</table>`
}

/**
 * Rend un email complet :
 * 1. charge le body fragment `app/{bodyTemplate}.html`
 * 2. interpole ses variables
 * 3. injecte le resultat dans le layout `_layout.html` avec TITLE/PREHEADER/BODY
 */
export interface RenderEmailParams {
  /** Nom du body fragment dans app/ (sans extension). Ex: 'welcome' */
  bodyTemplate: string
  title: string
  preheader: string
  /** Variables du body fragment. Les valeurs user DOIVENT etre passees par escapeHtml() par l'appelant. */
  vars: Record<string, string>
}

export function renderEmail({ bodyTemplate, title, preheader, vars }: RenderEmailParams): string {
  const bodyRaw = loadTemplate(`app/${bodyTemplate}.html`)
  const body = interpolate(bodyRaw, vars)
  const layout = loadTemplate('_layout.html')
  return interpolate(layout, {
    TITLE: escapeHtml(title),
    PREHEADER: escapeHtml(preheader),
    BODY: body,
  })
}

// ============================================================
// sendEmail — wrapper Resend partage
// ============================================================

export interface SendEmailParams {
  to: string | string[]
  subject: string
  html: string
  /** Tag optionnel pour logs et tracking Resend */
  tag?: string
}

export async function sendEmail({ to, subject, html, tag }: SendEmailParams): Promise<void> {
  const apiKey = process.env['RESEND_API_KEY']
  const from = process.env['RESEND_FROM_EMAIL'] ?? 'ClawBTP <noreply@clawbtp.fr>'
  const recipients = Array.isArray(to) ? to : [to]

  if (!apiKey) {
    if (process.env['NODE_ENV'] === 'production') {
      // En prod, l'absence de cle est une mis-config bloquante :
      // on throw pour que l'appelant remonte 500 et que l'admin sache pourquoi le mail n'est pas parti.
      logger.error({ tag, subject }, '[email] FAIL — RESEND_API_KEY missing in production')
      throw new Error('RESEND_API_KEY missing — cannot send email in production')
    }
    logger.warn({ tag, subject }, '[email] SKIP — RESEND_API_KEY missing (dev/test)')
    return
  }

  if (recipients.length === 0) {
    logger.warn({ tag, subject }, '[email] SKIP — recipients empty')
    return
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: recipients, subject, html }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const bodyText = await res.text()
      logger.error({ tag, status: res.status, body: bodyText, subject }, '[email] Resend HTTP error')
    } else {
      logger.info({ tag, subject, to: recipients }, '[email] sent via Resend')
    }
  } catch (err) {
    logger.error({ tag, err, subject }, '[email] send failed')
  }
}
