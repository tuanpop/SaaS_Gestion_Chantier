'use client'
// components/SidebarNavClient.tsx — migré Button shadcn (étape 7)
// Sidebar admin avec état actif via usePathname()
//
// RG-MIGR-002 — commentaires RBAC: visible admin only préservés
// D-2.5-020 — pas de darkMode classes

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoutButton } from '@/components/LogoutButton'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { cn } from '@/lib/utils'

// ============================================================
// Logique active state
// ============================================================

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') {
    return pathname === '/admin'
  }
  return pathname === href || pathname.startsWith(href + '/')
}

// ============================================================
// Composant
// ============================================================

interface SidebarNavClientProps {
  /** Si true, retire les classes responsive `hidden md:flex sticky` (utilisation dans un Sheet drawer mobile). Default: false (sidebar desktop classique). */
  inSheet?: boolean
}

export function SidebarNavClient({ inSheet = false }: SidebarNavClientProps = {}) {
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
      // RBAC: visible admin only
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
      // RBAC: visible admin only
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
      // RBAC: visible admin only
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
      // RBAC: visible admin only
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
      // RBAC: visible admin only
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      ),
      badge: '7',
    },
    // Sprint 6 — Alertes & Seuils (US-053 reachability UI — F003 BINDING)
    {
      href: '/admin/settings/derives',
      label: 'Alertes & Seuils',
      testId: 'nav-link-parametres-seuils',
      // RBAC: visible admin only
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      ),
    },
  ]

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col bg-[#163958] text-white',
        inSheet
          ? 'w-full h-full'                              // drawer Sheet : prend toute la largeur du SheetContent, pas de border-r (le SheetContent porte le sien)
          : 'w-[240px] hidden md:flex sticky top-0 h-screen z-40 border-r-2 border-black', // desktop : 240px sticky avec border-r
      )}
      aria-label="Navigation admin"
    >
      <div className="px-6 mb-8 flex items-center justify-between">
        <Link href="/admin" className="block">
          {/* RG-DS-006 : logo <span class="text-accent">Claw</span>BTP préservé */}
          <h1 className="font-heading font-[800] text-[22px] text-white">
            <span className="text-accent">Claw</span>BTP
          </h1>
        </Link>
        {/* NotificationBell desktop — visible uniquement en sidebar (hidden md:flex), pas dans le Sheet mobile */}
        {/* MobileAdminTopbar porte déjà la cloche en mobile — évite la double cloche */}
        {!inSheet && <NotificationBell />}
      </div>

      {navItems.map(({ href, label, icon, badge, testId }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            data-testid={testId}
            className={cn(
              'flex items-center gap-3 px-6 py-3 font-medium text-[15px] transition-colors',
              active
                ? 'bg-accent text-white font-bold border-l-4 border-white' // inline, supprime dépendance .sidebar a.active (globals.css)
                : 'text-[#94A3B8] hover:bg-primary hover:text-white',
            )}
          >
            {icon}
            {label}
            {badge && (
              <span className="ml-auto bg-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm">
                {/* T11 — rounded-sm (4px) au lieu de rounded (6px) */}
                {badge}
              </span>
            )}
          </Link>
        )
      })}

      {/* Séparateur + bouton déconnexion */}
      <div className="mt-auto pt-4 border-t border-[#1F4E79] mx-4">
        <LogoutButton variant="sidebar" />
      </div>
    </aside>
  )
}

export default SidebarNavClient
