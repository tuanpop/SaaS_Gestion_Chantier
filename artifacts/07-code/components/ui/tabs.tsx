'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// Piège 6 component-mapping : Tabs shadcn est contrôlé (value + onValueChange)
//   le sync searchParams doit être fait manuellement dans le CC wrapper
//   (préserver le pattern existant dans ChantierListClient / ChantierDetailAdminTabs)
// Design: TabsTrigger — border 2px noir, bottom-none, radius 6px 6px 0 0, Outfit 700
//   Active: bg-accent text-white
//   data-testid doit être sur les <TabsTrigger>

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Container tabs — flex, pas de shadow, fond transparent
      'inline-flex h-auto items-end gap-0',
      className,
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Neubrutalism BTP — .tab-brutal equivalent
      'inline-flex items-center justify-center whitespace-nowrap px-5 py-2.5',
      'font-heading font-bold text-sm border-2 border-black',
      // Radius haut uniquement (tab ouverte en bas) — rounded-t-[6px]
      'rounded-t-[6px] rounded-b-none',
      // Border bottom: quand inactif, fusionne avec la ligne sous les tabs
      'border-b-0',
      // Inactive state
      'bg-white text-[#222222]',
      'hover:bg-[#F2F2F2] transition-colors',
      // Active state — bg-accent text-white
      'data-[state=active]:bg-accent data-[state=active]:text-white',
      // Disabled
      'disabled:pointer-events-none disabled:opacity-50',
      // Focus
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(249,115,22)] focus-visible:ring-offset-1',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-0 ring-offset-background',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(249,115,22)] focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
