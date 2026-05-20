'use client'

// ============================================================
// EquipeClient — Client Component page Équipe admin
//
// Chantier 3 (Sprint UX-2) — Source : proto 18-admin-equipe.html
//
// Responsabilités :
//   1. Afficher la table des membres avec badges rôle et statut
//   2. Modal invitation conducteur/ouvrier (POST /api/users)
//   3. Modal QR (placeholder Sprint 3)
//   4. Handler "Renvoyer invitation" (POST /api/users/[id]/reinvite)
//   5. Toast inline auto-dismiss 4s
//
// R-02 : telephone accepté dans le payload conducteur (InviteUserSchema étendu Sprint UX-2)
//
// Sécurité :
//   - Pas de console.log — états React pour les erreurs/succès
//   - Validation client avant POST (email format, champs requis)
//   - Le payload envoyé correspond exactement au schéma serveur
// ============================================================

import { useState, useEffect, useCallback, useId } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import type { Tables } from '@/types/database'

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

interface ToastMsg {
  type: 'success' | 'error'
  message: string
}

interface InviteFormState {
  nom: string
  prenom: string
  email: string
  telephone: string
}

// Sprint 2 dette (2026-05-20) — état modal modification membre.
// userId vide = modal fermée. email/role en lecture seule (scope PATCH = nom/prenom/telephone).
interface EditFormState {
  userId: string
  nom: string
  prenom: string
  telephone: string
  // Champs read-only affichés pour contexte :
  email: string | null
  role: UserRole
}

// ============================================================
// Props
// ============================================================

interface EquipeClientProps {
  initialUsers: UserRow[]
  /** ID de l'admin connecté — le bouton Supprimer est masqué sur sa propre ligne */
  currentUserId: string
}

// ============================================================
// Helpers — badges rôle
// ============================================================

function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    admin: 'badge badge-primary',
    conducteur: 'badge badge-accent',
    ouvrier: 'badge badge-muted',
  }
  const labels: Record<UserRole, string> = {
    admin: 'Admin',
    conducteur: 'Conducteur',
    ouvrier: 'Ouvrier',
  }
  return <span className={styles[role]}>{labels[role]}</span>
}

// ============================================================
// Helper — badge statut invitation
// ============================================================

function StatutBadge({
  invitationStatus,
  role,
}: {
  invitationStatus: InvitationStatus | null
  role: UserRole
}) {
  // Ouvriers : pas d'invitation — afficher "Actif" directement
  if (role === 'ouvrier') {
    return <span className="badge badge-success">Actif</span>
  }

  // Admin sans invitation_status = actif
  if (!invitationStatus) {
    return <span className="badge badge-success">Actif</span>
  }

  const styles: Record<InvitationStatus, string> = {
    pending: 'badge badge-warning',
    active: 'badge badge-success',
    expired: 'badge badge-danger',
  }
  const labels: Record<InvitationStatus, string> = {
    pending: 'En attente',
    active: 'Actif',
    expired: 'Expiré',
  }
  return <span className={styles[invitationStatus]}>{labels[invitationStatus]}</span>
}

// ============================================================
// Composant principal
// ============================================================

export function EquipeClient({ initialUsers, currentUserId }: EquipeClientProps) {
  const router = useRouter()

  // ============================================================
  // État
  // ============================================================

  const [modalInvite, setModalInvite] = useState(false)
  const [modalQr, setModalQr] = useState<{ open: boolean; userId: string; userName: string }>({
    open: false,
    userId: '',
    userName: '',
  })
  const [inviteRole, setInviteRole] = useState<'admin' | 'conducteur' | 'ouvrier'>('conducteur')
  const [inviteForm, setInviteForm] = useState<InviteFormState>({
    nom: '',
    prenom: '',
    email: '',
    telephone: '',
  })
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [reinviteLoading, setReinviteLoading] = useState<string | null>(null) // user id en cours
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null) // user id en cours
  const [toast, setToast] = useState<ToastMsg | null>(null)

  // Sprint 2 dette — modal modification membre
  const [editForm, setEditForm] = useState<EditFormState | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // IDs accessibilité
  const inviteErrorId = useId()
  const editErrorId = useId()

  // ============================================================
  // Toast auto-dismiss
  // ============================================================

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  // ============================================================
  // Réinitialiser le formulaire à l'ouverture de la modal
  // ============================================================

  function openModalInvite() {
    setInviteForm({ nom: '', prenom: '', email: '', telephone: '' })
    setInviteError(null)
    setInviteRole('conducteur')
    setModalInvite(true)
  }

  // Sprint 2 dette — pré-remplir et ouvrir la modal d'édition
  function openModalEdit(user: UserRow) {
    setEditForm({
      userId: user.id,
      nom: user.nom,
      prenom: user.prenom,
      telephone: user.telephone ?? '',
      email: user.email,
      role: user.role as UserRole,
    })
    setEditError(null)
  }

  function closeModalEdit() {
    setEditForm(null)
    setEditError(null)
  }

  async function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editForm) return

    const nom = editForm.nom.trim()
    const prenom = editForm.prenom.trim()
    const telephoneRaw = editForm.telephone.trim()

    if (!nom || !prenom) {
      setEditError('Prénom et nom sont requis.')
      return
    }

    if (telephoneRaw && !/^\+?[0-9]{10,15}$/.test(telephoneRaw)) {
      setEditError('Format de téléphone invalide (10 à 15 chiffres, + optionnel).')
      return
    }

    // PATCH payload minimal — seulement les champs modifiés
    const payload: Record<string, string | null> = {}
    const initial = initialUsers.find((u) => u.id === editForm.userId)
    if (initial) {
      if (nom !== initial.nom) payload['nom'] = nom
      if (prenom !== initial.prenom) payload['prenom'] = prenom
      const initialTel = initial.telephone ?? ''
      if (telephoneRaw !== initialTel) {
        payload['telephone'] = telephoneRaw === '' ? null : telephoneRaw
      }
    }

    if (Object.keys(payload).length === 0) {
      setEditError('Aucune modification à enregistrer.')
      return
    }

    setEditLoading(true)
    try {
      const res = await fetch(`/api/users/${editForm.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        closeModalEdit()
        setToast({ type: 'success', message: 'Membre mis à jour.' })
        router.refresh()
        return
      }

      const data = (await res.json().catch(() => ({ error: null }))) as { error?: string }
      setEditError(data.error ?? 'Une erreur est survenue. Veuillez réessayer.')
    } catch {
      setEditError('Impossible de traiter la demande. Vérifiez votre connexion.')
    } finally {
      setEditLoading(false)
    }
  }

  // ============================================================
  // Handler — Inviter un membre
  // ============================================================

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setInviteError(null)

    // Validation client minimale
    const nom = inviteForm.nom.trim()
    const prenom = inviteForm.prenom.trim()
    const email = inviteForm.email.trim()

    if (!nom || !prenom) {
      setInviteError('Prénom et nom sont requis.')
      return
    }

    // admin et conducteur : email obligatoire (Supabase Auth + magic link).
    if ((inviteRole === 'admin' || inviteRole === 'conducteur') && !email) {
      setInviteError(
        inviteRole === 'admin'
          ? "L'email est requis pour un administrateur."
          : "L'email est requis pour un conducteur.",
      )
      return
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError("Format d'email invalide.")
      return
    }

    setInviteLoading(true)

    try {
      // Construction du payload selon le rôle
      // R-02 : telephone inclus pour les 3 rôles (optionnel)
      const telephone = inviteForm.telephone.trim()
        ? { telephone: inviteForm.telephone.trim() }
        : {}
      const payload =
        inviteRole === 'admin'
          ? { role: 'admin' as const, email, nom, prenom, ...telephone }
          : inviteRole === 'conducteur'
            ? { role: 'conducteur' as const, email, nom, prenom, ...telephone }
            : { role: 'ouvrier' as const, nom, prenom, ...telephone }

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setModalInvite(false)
        setToast({
          type: 'success',
          message:
            inviteRole === 'admin'
              ? 'Invitation administrateur envoyée par email.'
              : inviteRole === 'conducteur'
                ? 'Invitation conducteur envoyée par email.'
                : 'Ouvrier créé avec succès.',
        })
        router.refresh()
        return
      }

      const data = await res.json() as { error?: string }
      setInviteError(data.error ?? 'Une erreur est survenue. Veuillez réessayer.')
    } catch {
      setInviteError('Impossible de traiter la demande. Vérifiez votre connexion.')
    } finally {
      setInviteLoading(false)
    }
  }

  // ============================================================
  // Handler — Renvoyer invitation
  // ============================================================

  const handleReinvite = useCallback(async (userId: string, userName: string) => {
    setReinviteLoading(userId)

    try {
      const res = await fetch(`/api/users/${userId}/reinvite`, { method: 'POST' })

      if (res.ok) {
        setToast({ type: 'success', message: `Invitation renvoyée à ${userName}.` })
        router.refresh()
        return
      }

      const data = await res.json() as { error?: string }
      setToast({ type: 'error', message: data.error ?? "Impossible de renvoyer l'invitation." })
    } catch {
      setToast({ type: 'error', message: "Erreur réseau. Veuillez réessayer." })
    } finally {
      setReinviteLoading(null)
    }
  }, [router])

  // ============================================================
  // Handler — Supprimer un membre (soft delete)
  // ============================================================

  const handleDelete = useCallback(async (userId: string, userName: string) => {
    const confirmed = window.confirm(
      `Supprimer définitivement ${userName} ? Cette action est irréversible. L'utilisateur ne pourra plus se connecter. Les chantiers et tâches existants restent intacts.`,
    )
    if (!confirmed) return

    setDeleteLoading(userId)

    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' })

      if (res.status === 204) {
        setToast({ type: 'success', message: `${userName} a été supprimé.` })
        router.refresh()
        return
      }

      const data = await res.json() as { error?: string }
      setToast({ type: 'error', message: data.error ?? 'Impossible de supprimer ce membre.' })
    } catch {
      setToast({ type: 'error', message: 'Erreur réseau. Veuillez réessayer.' })
    } finally {
      setDeleteLoading(null)
    }
  }, [router])

  // ============================================================
  // Rendu
  // ============================================================

  return (
    <>
      {/* ======================================================
          Toast notification (top-right)
          ====================================================== */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-6 right-6 z-50 px-4 py-3 border-2 rounded-md text-sm font-medium flex items-center gap-2 max-w-sm ${
            toast.type === 'success'
              ? 'bg-[#E2EFDA] border-[#1E6B3C] text-[#1E6B3C]'
              : 'bg-[#FFCCCC] border-[#C00000] text-[#C00000]'
          }`}
        >
          {toast.message}
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Fermer"
            className="ml-auto"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ======================================================
          Header page
          ====================================================== */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading font-bold text-[28px] text-[#222]">Équipe</h1>
          <p className="text-[#555] text-sm mt-1">Gérez les membres de votre organisation</p>
        </div>
        <button
          type="button"
          onClick={openModalInvite}
          className="btn-brutal bg-[#F97316] text-white"
        >
          + Inviter un membre
        </button>
      </div>

      {/* ======================================================
          Table membres
          ====================================================== */}
      <div className="card-brutal overflow-hidden">
        <table className="table-brutal">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Rôle</th>
              <th>Email</th>
              <th>Téléphone</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-[#555] py-8">
                  Aucun membre dans votre organisation.
                </td>
              </tr>
            )}
            {initialUsers.map((user) => (
              <tr key={user.id}>
                <td className="font-semibold">
                  {user.prenom} {user.nom}
                </td>
                <td>
                  <RoleBadge role={user.role as UserRole} />
                </td>
                <td className={!user.email ? 'text-[#555]' : ''}>
                  {user.email ?? '—'}
                </td>
                <td className={!user.telephone ? 'text-[#555]' : ''}>
                  {user.telephone ?? '—'}
                </td>
                <td>
                  <StatutBadge
                    invitationStatus={user.invitation_status as InvitationStatus | null}
                    role={user.role as UserRole}
                  />
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    {/* Sprint 2 dette — bouton Modifier (nom/prenom/telephone) */}
                    <button
                      type="button"
                      data-testid={`edit-member-${user.id}`}
                      onClick={() => openModalEdit(user)}
                      disabled={
                        editLoading || reinviteLoading === user.id || deleteLoading === user.id
                      }
                      className="btn-brutal bg-white text-[#1F4E79] text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Modifier
                    </button>

                    {/* Conducteur en attente ou expiré → Renvoyer invitation */}
                    {user.role === 'conducteur' &&
                      (user.invitation_status === 'pending' || user.invitation_status === 'expired') && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleReinvite(user.id, `${user.prenom} ${user.nom}`)
                          }
                          disabled={reinviteLoading === user.id || deleteLoading === user.id}
                          className="btn-brutal bg-white text-[#1F4E79] text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {reinviteLoading === user.id ? 'Envoi...' : 'Renvoyer'}
                        </button>
                      )}

                    {/* Ouvrier → bouton QR */}
                    {user.role === 'ouvrier' && (
                      <button
                        type="button"
                        onClick={() =>
                          setModalQr({
                            open: true,
                            userId: user.id,
                            userName: `${user.prenom} ${user.nom}`,
                          })
                        }
                        className="btn-brutal bg-white text-[#1F4E79] text-xs px-3 py-1.5"
                      >
                        QR
                      </button>
                    )}

                    {/* Bouton Supprimer — masqué sur la ligne du user courant */}
                    {user.id !== currentUserId && (
                      <button
                        type="button"
                        onClick={() =>
                          void handleDelete(user.id, `${user.prenom} ${user.nom}`)
                        }
                        disabled={deleteLoading === user.id || reinviteLoading === user.id}
                        className="btn-brutal bg-white text-[#C00000] border-[#C00000] shadow-[3px_3px_0_#C00000] hover:bg-[#FFCCCC] text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deleteLoading === user.id ? 'Suppression...' : 'Supprimer'}
                      </button>
                    )}

                    {/* Sprint 2 dette : fallback "—" supprimé — le bouton "Modifier"
                        est toujours présent, donc il n'y a plus de ligne sans action. */}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ======================================================
          Modal — Inviter un collaborateur
          ====================================================== */}
      {modalInvite && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalInvite(false)
          }}
        >
          <div className="card-brutal p-8 max-w-lg w-full bg-white">
            {/* Titre */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-heading font-bold text-[22px]">Inviter un collaborateur</h2>
              <button
                type="button"
                onClick={() => setModalInvite(false)}
                aria-label="Fermer la modal"
                className="text-[#555] hover:text-[#222] transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Role switcher */}
            <div
              role="tablist"
              aria-label="Rôle du collaborateur"
              className="flex mb-6"
            >
              {/* Sprint 2 dette (2026-05-20) — 3 tabs : Admin / Conducteur / Ouvrier */}
              <button
                role="tab"
                aria-selected={inviteRole === 'admin'}
                type="button"
                data-testid="invite-role-admin"
                onClick={() => {
                  setInviteRole('admin')
                  setInviteError(null)
                }}
                className={`tab-brutal flex-1 rounded-l-md border-r-0 ${
                  inviteRole === 'admin' ? 'active' : ''
                }`}
              >
                Admin
              </button>
              <button
                role="tab"
                aria-selected={inviteRole === 'conducteur'}
                type="button"
                onClick={() => {
                  setInviteRole('conducteur')
                  setInviteError(null)
                }}
                className={`tab-brutal flex-1 border-r-0 ${
                  inviteRole === 'conducteur' ? 'active' : ''
                }`}
              >
                Conducteur
              </button>
              <button
                role="tab"
                aria-selected={inviteRole === 'ouvrier'}
                type="button"
                onClick={() => {
                  setInviteRole('ouvrier')
                  setInviteError(null)
                }}
                className={`tab-brutal flex-1 rounded-r-md ${
                  inviteRole === 'ouvrier' ? 'active' : ''
                }`}
              >
                Ouvrier
              </button>
            </div>

            {/* Erreur inline */}
            {inviteError && (
              <div
                id={inviteErrorId}
                role="alert"
                className="mb-4 px-4 py-3 border-2 border-[#C00000] bg-[#FFCCCC] text-[#C00000] text-sm rounded-md"
              >
                {inviteError}
              </div>
            )}

            {/* Formulaire */}
            <form
              onSubmit={(e) => void handleInvite(e)}
              aria-describedby={inviteError ? inviteErrorId : undefined}
              noValidate
            >
              {/* Prénom + Nom — 2 colonnes */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-[#222] mb-1.5">
                    Prénom <span aria-hidden="true" className="text-[#C00000]">*</span>
                  </label>
                  <input
                    type="text"
                    name="prenom"
                    autoComplete="given-name"
                    required
                    value={inviteForm.prenom}
                    onChange={(e) =>
                      setInviteForm((prev) => ({ ...prev, prenom: e.target.value }))
                    }
                    disabled={inviteLoading}
                    className="input-brutal"
                    placeholder="Jean"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#222] mb-1.5">
                    Nom <span aria-hidden="true" className="text-[#C00000]">*</span>
                  </label>
                  <input
                    type="text"
                    name="nom"
                    autoComplete="family-name"
                    required
                    value={inviteForm.nom}
                    onChange={(e) =>
                      setInviteForm((prev) => ({ ...prev, nom: e.target.value }))
                    }
                    disabled={inviteLoading}
                    className="input-brutal"
                    placeholder="Dupont"
                  />
                </div>
              </div>

              {/* ADMIN + CONDUCTEUR : Email requis, Téléphone optionnel
                  (Sprint 2 dette : variant admin partage le même flow d'invitation
                  email + Supabase Auth que conducteur — seul le rôle final diffère). */}
              {(inviteRole === 'admin' || inviteRole === 'conducteur') && (
                <>
                  {inviteRole === 'admin' && (
                    <div className="mb-4 px-4 py-3 border-2 border-[#1F4E79] bg-[#E8F0FA] text-[#1F4E79] text-xs rounded-md">
                      Un administrateur a tous les droits sur l&apos;organisation (chantiers, équipe, facturation).
                    </div>
                  )}
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-[#222] mb-1.5">
                      Email <span aria-hidden="true" className="text-[#C00000]">*</span>
                    </label>
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                      value={inviteForm.email}
                      onChange={(e) =>
                        setInviteForm((prev) => ({ ...prev, email: e.target.value }))
                      }
                      disabled={inviteLoading}
                      className="input-brutal"
                      placeholder={
                        inviteRole === 'admin' ? 'admin@entreprise.fr' : 'conducteur@chantier.fr'
                      }
                      inputMode="email"
                    />
                  </div>
                  <div className="mb-5">
                    <label className="block text-sm font-semibold text-[#222] mb-1.5">
                      Téléphone{' '}
                      <span className="text-[#555] font-normal text-xs">(optionnel)</span>
                    </label>
                    <input
                      type="tel"
                      name="telephone"
                      autoComplete="tel"
                      value={inviteForm.telephone}
                      onChange={(e) =>
                        setInviteForm((prev) => ({ ...prev, telephone: e.target.value }))
                      }
                      disabled={inviteLoading}
                      className="input-brutal"
                      placeholder="06 12 34 56 78"
                    />
                  </div>
                </>
              )}

              {/* OUVRIER : Téléphone d'abord, Email optionnel */}
              {inviteRole === 'ouvrier' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-[#222] mb-1.5">
                      Téléphone
                    </label>
                    <input
                      type="tel"
                      name="telephone"
                      autoComplete="tel"
                      value={inviteForm.telephone}
                      onChange={(e) =>
                        setInviteForm((prev) => ({ ...prev, telephone: e.target.value }))
                      }
                      disabled={inviteLoading}
                      className="input-brutal"
                      placeholder="06 12 34 56 78"
                    />
                  </div>
                  <div className="mb-5 opacity-60">
                    <label className="block text-sm font-semibold text-[#222] mb-1.5">
                      Email{' '}
                      <span className="text-[#555] font-normal text-xs">(optionnel)</span>
                    </label>
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      value={inviteForm.email}
                      onChange={(e) =>
                        setInviteForm((prev) => ({ ...prev, email: e.target.value }))
                      }
                      disabled={inviteLoading}
                      className="input-brutal"
                      placeholder="ouvrier@exemple.fr"
                      inputMode="email"
                    />
                  </div>
                </>
              )}

              {/* Boutons */}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setModalInvite(false)}
                  disabled={inviteLoading}
                  className="btn-brutal bg-white text-[#1F4E79]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={inviteLoading}
                  aria-busy={inviteLoading}
                  className="btn-brutal bg-[#F97316] text-white"
                >
                  {inviteLoading ? 'Envoi...' : 'Inviter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================
          Modal — QR Code ouvrier
          PNG servi par GET /api/users/[id]/qr (généré côté serveur)
          ====================================================== */}
      {modalQr.open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setModalQr({ open: false, userId: '', userName: '' })
            }
          }}
        >
          <div className="card-brutal p-8 max-w-md w-full bg-white text-center">
            <h2 className="font-heading font-bold text-[22px] mb-6">
              QR Code — {modalQr.userName}
            </h2>

            {/* QR image */}
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

            {/* Imprimer — ouvre le PNG dans un nouvel onglet, l'utilisateur Ctrl+P */}
            <a
              href={`/api/users/${modalQr.userId}/qr`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-brutal bg-[#F97316] text-white w-full justify-center mb-3 inline-block"
            >
              Ouvrir pour imprimer
            </a>

            <button
              type="button"
              onClick={() => setModalQr({ open: false, userId: '', userName: '' })}
              className="btn-brutal bg-white text-[#1F4E79] w-full justify-center"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ======================================================
          Modal — Modifier un membre (Sprint 2 dette 2026-05-20)
          Scope : nom, prenom, telephone. email et role read-only.
          ====================================================== */}
      {editForm && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModalEdit()
          }}
        >
          <div className="card-brutal p-8 max-w-lg w-full bg-white">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-heading font-bold text-[22px]">Modifier un membre</h2>
              <button
                type="button"
                onClick={closeModalEdit}
                aria-label="Fermer la modal"
                className="text-[#555] hover:text-[#222] transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {editError && (
              <div
                id={editErrorId}
                role="alert"
                className="mb-4 px-4 py-3 border-2 border-[#C00000] bg-[#FFCCCC] text-[#C00000] text-sm rounded-md"
              >
                {editError}
              </div>
            )}

            <form
              onSubmit={(e) => void handleEditSubmit(e)}
              aria-describedby={editError ? editErrorId : undefined}
              noValidate
            >
              {/* Read-only : role + email pour contexte */}
              <div className="grid grid-cols-2 gap-4 mb-4 p-3 bg-[#F8F8F8] border border-[#E5E5E5] rounded-md">
                <div>
                  <div className="text-xs uppercase text-[#555] font-semibold mb-1">Rôle</div>
                  <div className="text-sm font-medium">
                    {editForm.role === 'admin' ? 'Admin' : editForm.role === 'conducteur' ? 'Conducteur' : 'Ouvrier'}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-[#555] font-semibold mb-1">Email</div>
                  <div className="text-sm font-medium truncate" title={editForm.email ?? '—'}>
                    {editForm.email ?? '—'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="edit-prenom" className="block text-sm font-semibold text-[#222] mb-1.5">
                    Prénom <span aria-hidden="true" className="text-[#C00000]">*</span>
                  </label>
                  <input
                    id="edit-prenom"
                    type="text"
                    autoComplete="given-name"
                    required
                    value={editForm.prenom}
                    onChange={(e) => setEditForm({ ...editForm, prenom: e.target.value })}
                    disabled={editLoading}
                    className="input-brutal"
                  />
                </div>
                <div>
                  <label htmlFor="edit-nom" className="block text-sm font-semibold text-[#222] mb-1.5">
                    Nom <span aria-hidden="true" className="text-[#C00000]">*</span>
                  </label>
                  <input
                    id="edit-nom"
                    type="text"
                    autoComplete="family-name"
                    required
                    value={editForm.nom}
                    onChange={(e) => setEditForm({ ...editForm, nom: e.target.value })}
                    disabled={editLoading}
                    className="input-brutal"
                  />
                </div>
              </div>

              <div className="mb-5">
                <label htmlFor="edit-telephone" className="block text-sm font-semibold text-[#222] mb-1.5">
                  Téléphone{' '}
                  <span className="text-[#555] font-normal text-xs">(optionnel)</span>
                </label>
                <input
                  id="edit-telephone"
                  type="tel"
                  autoComplete="tel"
                  value={editForm.telephone}
                  onChange={(e) => setEditForm({ ...editForm, telephone: e.target.value })}
                  disabled={editLoading}
                  className="input-brutal"
                  placeholder="06 12 34 56 78"
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={closeModalEdit}
                  disabled={editLoading}
                  className="btn-brutal bg-white text-[#1F4E79]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  data-testid="edit-member-submit"
                  disabled={editLoading}
                  aria-busy={editLoading}
                  className="btn-brutal bg-[#F97316] text-white"
                >
                  {editLoading ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

export default EquipeClient
