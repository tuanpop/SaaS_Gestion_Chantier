'use client'
// components/SidebarNavClient.tsx
// Sidebar admin avec état actif via usePathname()
// Client Component — extraction depuis admin/layout.tsx (Server Component)
//
// T01 — sidebar active state non implémenté
// T11 — badge Chats rounded-sm (4px) au lieu de rounded (6px)
//
// Pattern Next.js 15 recommandé : layout admin = Server Component, sidebar = Client Component
// Aucun import serveur ici (pas de lib/supabase/server, pas de next/headers)
//
// Règle active :
//   - /admin        → pathname === '/admin' uniquement (évite d'activer sur tous les sous-chemins)
//   - autres items  → startsWith(href) OU startsWith(href + '/')

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// ============================================================
// Logique active state
// ============================================================

function isActive(pathname: string, href: string): boolean {
  // Dashboard : exact match uniquement (sinon tout est "actif" car tout commence par /admin)
  if (href === '/admin') {
    return pathname === '/admin'
  }
  return pathname === href || pathname.startsWith(href + '/')
}

// ============================================================
// Composant
// ============================================================

export function SidebarNavClient() {
  const pathname = usePathname()

  const navItems = [
    {
      href: '/admin',
      label: 'Dashboard',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
      ),
    },
    {
      href: '/admin/chantiers',
      label: 'Chantiers',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      ),
    },
    {
      href: '/admin/equipe',
      label: 'Équipe',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
      ),
    },
    {
      href: '/admin/comptabilite',
      label: 'Comptabilité',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
      ),
    },
    {
      href: '/admin/notifications',
      label: 'Notifications',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
      ),
    },
    {
      href: '/admin/chats',
      label: 'Chats',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      ),
      badge: '7', // T11 — badge Chats hardcodé (Sprint 8 pour dynamique)
    },
  ]

  return (
    <nav className="sidebar">
      <div className="px-6 mb-8">
        <Link href="/admin" className="block">
          <h1 className="font-heading font-[800] text-[22px] text-white">
            <span className="text-accent">Claw</span>BTP
          </h1>
        </Link>
      </div>

      {navItems.map(({ href, label, icon, badge }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-6 py-3 font-medium text-[15px] transition-colors ${
              active
                ? 'active'  /* .sidebar a.active = bg accent, text white, border-left */
                : 'text-[#94A3B8] hover:bg-primary hover:text-white'
            }`}
          >
            {icon}
            {label}
            {badge && (
              <span className="ml-auto bg-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm">
                {/* T11 — rounded-sm (4px) au lieu de rounded (6px) — proto 15-admin-dashboard.html l.112 */}
                {badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

export default SidebarNavClient
