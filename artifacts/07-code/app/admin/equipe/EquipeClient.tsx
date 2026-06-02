'use client'

// ============================================================
// EquipeClient — migré étape 6 (Dialog + react-hook-form + ConfirmDialog + useToast)
//
// D-2.5-016 — modals Inviter/Modifier → Dialog + Form react-hook-form
// D-2.5-017 — handleDelete → ConfirmDialog destructive
// RG-MIGR-006 — window.confirm supprimé
// Piège 8 — état toast local supprimé → useToast() global
// K2.5-D-06 — Button disabled={isSubmitting}
// K2.5-T-10 — schemas depuis lib/validation/users.ts
// RG-MIGR-002 — commentaires RBAC préservés
// data-testid préservés : invite-role-admin, edit-member-{id}, edit-member-submit
// ============================================================

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Tables } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/lib/hooks/use-toast'
// K2.5-T-10 — schemas uniques depuis lib/validation/
import { InviteUserSchema, PatchUserSchema, type InviteUserInput, type PatchUserInput } from '@/lib/validation/users'

// ============================================================
// Types
// ============================================================

type UserRole = 'admin' | 'conducteur' | 'ouvrier'
type InvitationStatus = 'pending' | 'active' | 'expired'

type UserRow = Pick<
  Tables<'users'>,
  | 'id'
  | 'role'
  | 'nom'
  | 'prenom'
  | 'email'
  | 'telephone'
  | 'invitation_status'
  | 'has_supabase_auth'
  | 'created_at'
>

interface EquipeClientProps {
  initialUsers: UserRow[]
  /** ID de l'admin connecté — le bouton Supprimer est masqué sur sa propre ligne */
  currentUserId: string
}

// ============================================================
// Helpers — badges rôle
// ============================================================

function RoleBadge({ role }: { role: UserRole }) {
  const variants: Record<UserRole, 'primary' | 'accent' | 'muted'> = {
    admin: 'primary',
    conducteur: 'accent',
    ouvrier: 'muted',
  }
  const labels: Record<UserRole, string> = {
    admin: 'Admin',
    conducteur: 'Conducteur',
    ouvrier: 'Ouvrier',
  }
  return <Badge variant={variants[role]}>{labels[role]}</Badge>
}

function StatutBadge({
  invitationStatus,
  role,
}: {
  invitationStatus: InvitationStatus | null
  role: UserRole
}) {
  if (role === 'ouvrier') {
    return <Badge variant="success">Actif</Badge>
  }
  if (!invitationStatus) {
    return <Badge variant="success">Actif</Badge>
  }
  const variants: Record<InvitationStatus, 'warning' | 'success' | 'danger'> = {
    pending: 'warning',
    active: 'success',
    expired: 'danger',
  }
  const labels: Record<InvitationStatus, string> = {
    pending: 'En attente',
    active: 'Actif',
    expired: 'Expiré',
  }
  return <Badge variant={variants[invitationStatus]}>{labels[invitationStatus]}</Badge>
}

// ============================================================
// Composant principal
// ============================================================

export function EquipeClient({ initialUsers, currentUserId }: EquipeClientProps) {
  const router = useRouter()
  const { toast } = useToast()

  // ============================================================
  // État modals
  // ============================================================

  const [modalInvite, setModalInvite] = useState(false)
  const [modalQr, setModalQr] = useState<{ open: boolean; userId: string; userName: string }>({
    open: false,
    userId: '',
    userName: '',
  })
  const [inviteRole, setInviteRole] = useState<UserRole>('conducteur')

  // Modal Modifier
  const [editUserId, setEditUserId] = useState<string | null>(null)
  const [editUserContext, setEditUserContext] = useState<{
    email: string | null
    role: UserRole
    initialValues: { prenom: string; nom: string; telephone: string }
  } | null>(null)

  // Confirm delete
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const [reinviteLoading, setReinviteLoading] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)

  // ============================================================
  // Form Inviter — react-hook-form
  // ============================================================

  const inviteForm = useForm<InviteUserInput>({
    resolver: zodResolver(InviteUserSchema),
    defaultValues: {
      prenom: '',
      nom: '',
      email: '',
      telephone: '',
      role: 'conducteur',
    },
  })

  function openModalInvite() {
    inviteForm.reset({ prenom: '', nom: '', email: '', telephone: '', role: 'conducteur' })
    setInviteRole('conducteur')
    setModalInvite(true)
  }

  async function onInviteSubmit(values: InviteUserInput) {
    const telephone = values.telephone?.trim() ? { telephone: values.telephone.trim() } : {}
    const payload =
      inviteRole === 'admin'
        ? { role: 'admin' as const, email: values.email, nom: values.nom, prenom: values.prenom, ...telephone }
        : inviteRole === 'conducteur'
          ? { role: 'conducteur' as const, email: values.email, nom: values.nom, prenom: values.prenom, ...telephone }
          : { role: 'ouvrier' as const, nom: values.nom, prenom: values.prenom, ...telephone }

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      setModalInvite(false)
      // K2.5-T-08 : description = JSX
      toast({
        variant: 'success',
        title: 'Membre ajouté',
        description: inviteRole === 'admin'
          ? <span>Invitation administrateur envoyée par email.</span>
          : inviteRole === 'conducteur'
            ? <span>Invitation conducteur envoyée par email.</span>
            : <span>Ouvrier créé avec succès.</span>,
      })
      router.refresh()
      return
    }

    const data = await res.json() as { error?: string }
    inviteForm.setError('root', {
      type: 'server',
      message: data.error ?? 'Une erreur est survenue. Veuillez réessayer.',
    })
  }

  // ============================================================
  // Form Modifier — react-hook-form
  // ============================================================

  const editForm = useForm<PatchUserInput>({
    resolver: zodResolver(PatchUserSchema),
    defaultValues: { prenom: '', nom: '', telephone: '' },
  })

  function openModalEdit(user: UserRow) {
    setEditUserId(user.id)
    setEditUserContext({
      email: user.email,
      role: user.role as UserRole,
      initialValues: {
        prenom: user.prenom,
        nom: user.nom,
        telephone: user.telephone ?? '',
      },
    })
    editForm.reset({
      prenom: user.prenom,
      nom: user.nom,
      telephone: user.telephone ?? '',
    })
  }

  function closeModalEdit() {
    setEditUserId(null)
    setEditUserContext(null)
    editForm.reset()
  }

  async function onEditSubmit(values: PatchUserInput) {
    if (!editUserId || !editUserContext) return

    // Payload minimal — seulement les champs modifiés
    const payload: Record<string, string | null> = {}
    const { initialValues } = editUserContext
    if (values.nom !== undefined && values.nom !== initialValues.nom) payload['nom'] = values.nom
    if (values.prenom !== undefined && values.prenom !== initialValues.prenom) payload['prenom'] = values.prenom
    const telephone = values.telephone ?? ''
    if (telephone !== initialValues.telephone) {
      payload['telephone'] = telephone === '' ? null : telephone
    }

    if (Object.keys(payload).length === 0) {
      editForm.setError('root', { type: 'manual', message: 'Aucune modification à enregistrer.' })
      return
    }

    const res = await fetch(`/api/users/${editUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      closeModalEdit()
      // K2.5-T-08 : description = JSX
      toast({
        variant: 'success',
        title: 'Membre mis à jour',
        description: <span>Les modifications ont été enregistrées.</span>,
      })
      router.refresh()
      return
    }

    const data = (await res.json().catch(() => ({ error: null }))) as { error?: string }
    editForm.setError('root', {
      type: 'server',
      message: data.error ?? 'Une erreur est survenue. Veuillez réessayer.',
    })
  }

  // ============================================================
  // Handler — Renvoyer invitation
  // ============================================================

  const handleReinvite = useCallback(async (userId: string, userName: string) => {
    setReinviteLoading(userId)
    try {
      const res = await fetch(`/api/users/${userId}/reinvite`, { method: 'POST' })
      if (res.ok) {
        // K2.5-T-08 : description = JSX
        toast({
          variant: 'success',
          description: <span>Invitation renvoyée à {userName}.</span>,
        })
        router.refresh()
        return
      }
      const data = await res.json() as { error?: string }
      toast({
        variant: 'destructive',
        description: <span>{data.error ?? "Impossible de renvoyer l'invitation."}</span>,
      })
    } catch {
      toast({ variant: 'destructive', description: <span>Erreur réseau. Veuillez réessayer.</span> })
    } finally {
      setReinviteLoading(null)
    }
  }, [router, toast])

  // ============================================================
  // Handler — Supprimer un membre (soft delete)
  // D-2.5-017 : window.confirm → ConfirmDialog
  // ============================================================

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleteLoading(deleteTarget.id)
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE' })
      if (res.status === 204) {
        // K2.5-T-08 : description = JSX
        toast({
          variant: 'success',
          description: <span>{deleteTarget.name} a été supprimé.</span>,
        })
        router.refresh()
        return
      }
      const data = await res.json() as { error?: string }
      toast({
        variant: 'destructive',
        description: <span>{data.error ?? 'Impossible de supprimer ce membre.'}</span>,
      })
    } catch {
      toast({ variant: 'destructive', description: <span>Erreur réseau. Veuillez réessayer.</span> })
    } finally {
      setDeleteLoading(null)
      setDeleteTarget(null)
    }
  }

  // ============================================================
  // Rendu
  // ============================================================

  return (
    <>
      {/* ======================================================
          Header page
          ====================================================== */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading font-bold text-[28px] text-[#222]">Équipe</h1>
          <p className="text-[#555] text-sm mt-1">Gérez les membres de votre organisation</p>
        </div>
        {/* RBAC: visible admin only */}
        <Button onClick={openModalInvite} data-testid="invite-member-btn">
          + Inviter un membre
        </Button>
      </div>

      {/* ======================================================
          Table membres — shadcn Table
          ====================================================== */}
      <div className="card-brutal overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Téléphone</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-[#555] py-8">
                  Aucun membre dans votre organisation.
                </TableCell>
              </TableRow>
            )}
            {initialUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-semibold">
                  {user.prenom} {user.nom}
                </TableCell>
                <TableCell>
                  <RoleBadge role={user.role as UserRole} />
                </TableCell>
                <TableCell className={!user.email ? 'text-[#555]' : ''}>
                  {user.email ?? '—'}
                </TableCell>
                <TableCell className={!user.telephone ? 'text-[#555]' : ''}>
                  {user.telephone ?? '—'}
                </TableCell>
                <TableCell>
                  <StatutBadge
                    invitationStatus={user.invitation_status as InvitationStatus | null}
                    role={user.role as UserRole}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {/* Sprint 2 dette — bouton Modifier (nom/prenom/telephone) */}
                    <Button
                      type="button"
                      data-testid={`edit-member-${user.id}`}
                      onClick={() => openModalEdit(user)}
                      disabled={deleteLoading === user.id || reinviteLoading === user.id}
                      variant="outline"
                      size="sm"
                    >
                      Modifier
                    </Button>

                    {/* Conducteur en attente ou expiré → Renvoyer invitation */}
                    {user.role === 'conducteur' &&
                      (user.invitation_status === 'pending' || user.invitation_status === 'expired') && (
                        <Button
                          type="button"
                          onClick={() => void handleReinvite(user.id, `${user.prenom} ${user.nom}`)}
                          disabled={reinviteLoading === user.id || deleteLoading === user.id}
                          variant="outline"
                          size="sm"
                        >
                          {reinviteLoading === user.id ? 'Envoi...' : 'Renvoyer'}
                        </Button>
                      )}

                    {/* Ouvrier → bouton QR */}
                    {user.role === 'ouvrier' && (
                      <Button
                        type="button"
                        onClick={() => setModalQr({ open: true, userId: user.id, userName: `${user.prenom} ${user.nom}` })}
                        variant="outline"
                        size="sm"
                      >
                        QR
                      </Button>
                    )}

                    {/* RBAC: Bouton Supprimer — masqué sur la ligne du user courant */}
                    {user.id !== currentUserId && (
                      <Button
                        type="button"
                        onClick={() => setDeleteTarget({ id: user.id, name: `${user.prenom} ${user.nom}` })}
                        disabled={deleteLoading === user.id || reinviteLoading === user.id}
                        variant="destructive"
                        size="sm"
                      >
                        {deleteLoading === user.id ? 'Suppression...' : 'Supprimer'}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ======================================================
          Modal — Inviter un collaborateur — Dialog + Form RHF
          ====================================================== */}
      <Dialog open={modalInvite} onOpenChange={(open) => { if (!open) setModalInvite(false) }}>
        <DialogContent className="max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle>Inviter un collaborateur</DialogTitle>
          </DialogHeader>

          {/* Tabs Admin / Conducteur / Ouvrier */}
          <Tabs
            value={inviteRole}
            onValueChange={(v) => {
              setInviteRole(v as UserRole)
              inviteForm.clearErrors()
            }}
          >
            <TabsList>
              {/* data-testid préservé : invite-role-admin */}
              <TabsTrigger value="admin" data-testid="invite-role-admin">Admin</TabsTrigger>
              <TabsTrigger value="conducteur">Conducteur</TabsTrigger>
              <TabsTrigger value="ouvrier">Ouvrier</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Erreur serveur */}
          {inviteForm.formState.errors.root && (
            <div role="alert" className="px-4 py-3 bg-danger-bg border-2 border-danger text-danger text-sm rounded-[6px]">
              {inviteForm.formState.errors.root.message}
            </div>
          )}

          {/* RG-MIGR-003 : form aria-busy={isSubmitting} */}
          <Form {...inviteForm}>
            <form
              onSubmit={inviteForm.handleSubmit(onInviteSubmit)}
              className="space-y-4"
              aria-busy={inviteForm.formState.isSubmitting}
            >
              {inviteRole === 'admin' && (
                <div className="px-4 py-3 border-2 border-[#1F4E79] bg-[#E8F0FA] text-[#1F4E79] text-xs rounded-[6px]">
                  Un administrateur a tous les droits sur l&apos;organisation (chantiers, équipe, facturation).
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={inviteForm.control}
                  name="prenom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prénom <span className="text-danger normal-case font-normal">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="given-name" placeholder="Jean" disabled={inviteForm.formState.isSubmitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={inviteForm.control}
                  name="nom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom <span className="text-danger normal-case font-normal">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="family-name" placeholder="Dupont" disabled={inviteForm.formState.isSubmitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Admin + Conducteur : email requis */}
              {(inviteRole === 'admin' || inviteRole === 'conducteur') && (
                <>
                  <FormField
                    control={inviteForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Email <span className="text-danger normal-case font-normal">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            autoComplete="email"
                            inputMode="email"
                            placeholder={inviteRole === 'admin' ? 'admin@entreprise.fr' : 'conducteur@chantier.fr'}
                            disabled={inviteForm.formState.isSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={inviteForm.control}
                    name="telephone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Téléphone <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                        <FormControl>
                          <Input {...field} type="tel" autoComplete="tel" placeholder="06 12 34 56 78" disabled={inviteForm.formState.isSubmitting} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* Ouvrier : téléphone en premier */}
              {inviteRole === 'ouvrier' && (
                <>
                  <FormField
                    control={inviteForm.control}
                    name="telephone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Téléphone</FormLabel>
                        <FormControl>
                          <Input {...field} type="tel" autoComplete="tel" placeholder="06 12 34 56 78" disabled={inviteForm.formState.isSubmitting} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="opacity-60">
                    <FormField
                      control={inviteForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                          <FormControl>
                            <Input {...field} type="email" autoComplete="email" inputMode="email" placeholder="ouvrier@exemple.fr" disabled={inviteForm.formState.isSubmitting} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalInvite(false)} disabled={inviteForm.formState.isSubmitting}>
                  Annuler
                </Button>
                {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
                <Button type="submit" disabled={inviteForm.formState.isSubmitting} data-testid="invite-submit">
                  {inviteForm.formState.isSubmitting ? 'Envoi...' : 'Inviter'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ======================================================
          Modal — QR Code ouvrier
          ====================================================== */}
      <Dialog open={modalQr.open} onOpenChange={(open) => { if (!open) setModalQr({ open: false, userId: '', userName: '' }) }}>
        <DialogContent className="max-w-md bg-white text-center">
          <DialogHeader>
            <DialogTitle>QR Code — {modalQr.userName}</DialogTitle>
          </DialogHeader>

          <div className="card-brutal p-4 mx-auto w-fit mb-6 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/users/${modalQr.userId}/qr`}
              alt={`QR code de ${modalQr.userName}`}
              width={280}
              height={280}
              className="block"
            />
          </div>

          <p className="text-[#555] text-sm mb-6">
            À imprimer et remettre à l&apos;ouvrier. Le scan ouvre sa session terrain.
          </p>

          <DialogFooter className="flex-col gap-2">
            <Button asChild className="w-full">
              <a href={`/api/users/${modalQr.userId}/qr`} target="_blank" rel="noopener noreferrer">
                Ouvrir pour imprimer
              </a>
            </Button>
            <Button variant="outline" onClick={() => setModalQr({ open: false, userId: '', userName: '' })} className="w-full">
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================================================
          Modal — Modifier un membre — Dialog + Form RHF
          data-testid préservé : edit-member-submit
          ====================================================== */}
      <Dialog open={!!editUserId} onOpenChange={(open) => { if (!open) closeModalEdit() }}>
        <DialogContent className="max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle>Modifier un membre</DialogTitle>
          </DialogHeader>

          {/* Contexte read-only : role + email */}
          {editUserContext && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-[#F8F8F8] border border-[#E5E5E5] rounded-[6px]">
              <div>
                <div className="text-xs uppercase text-[#555] font-semibold mb-1">Rôle</div>
                <div className="text-sm font-medium">
                  {editUserContext.role === 'admin' ? 'Admin' : editUserContext.role === 'conducteur' ? 'Conducteur' : 'Ouvrier'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-[#555] font-semibold mb-1">Email</div>
                <div className="text-sm font-medium truncate" title={editUserContext.email ?? '—'}>
                  {editUserContext.email ?? '—'}
                </div>
              </div>
            </div>
          )}

          {/* Erreur serveur */}
          {editForm.formState.errors.root && (
            <div role="alert" className="px-4 py-3 bg-danger-bg border-2 border-danger text-danger text-sm rounded-[6px]">
              {editForm.formState.errors.root.message}
            </div>
          )}

          {/* RG-MIGR-003 : form aria-busy={isSubmitting} */}
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit(onEditSubmit)}
              className="space-y-4"
              aria-busy={editForm.formState.isSubmitting}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="prenom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prénom <span className="text-danger normal-case font-normal">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="given-name" disabled={editForm.formState.isSubmitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="nom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom <span className="text-danger normal-case font-normal">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="family-name" disabled={editForm.formState.isSubmitting} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editForm.control}
                name="telephone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                    <FormControl>
                      <Input {...field} type="tel" autoComplete="tel" placeholder="06 12 34 56 78" disabled={editForm.formState.isSubmitting} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeModalEdit} disabled={editForm.formState.isSubmitting}>
                  Annuler
                </Button>
                {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
                {/* data-testid préservé : edit-member-submit */}
                <Button type="submit" disabled={editForm.formState.isSubmitting} data-testid="edit-member-submit">
                  {editForm.formState.isSubmitting ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ======================================================
          ConfirmDialog — Supprimer un membre
          D-2.5-017 — RG-MIGR-006 — window.confirm supprimé
          ====================================================== */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Supprimer ce membre ?"
        description={deleteTarget
          ? `Supprimer définitivement ${deleteTarget.name} ? Cette action est irréversible. L'utilisateur ne pourra plus se connecter. Les chantiers et tâches existants restent intacts.`
          : ''}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
      />
    </>
  )
}

export default EquipeClient
