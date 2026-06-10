// lib/reporting/pdf/CrDocument.tsx — Template PDF Compte Rendu journalier
// D-5-07 : @react-pdf/renderer, renderToBuffer côté handler Node
// RG-PDF-002 BINDING : champs obligatoires (org, chantier, date, contenu, conducteur, valide_at)
// SURF-5-10 Kakashi : contenu rendu en texte pur uniquement (sécurité anti-XSS)
// Aucune URL d'origine user/LLM passée à des composants graphiques

import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { CompteRendu } from '@/types/reporting'

// ============================================================
// Types props
// ============================================================

export interface CrDocumentProps {
  cr: CompteRendu
  chantierNom: string
  organisationNom: string
  conducteurNom: string | null   // Nom du validateur (null si user supprimé)
}

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 11,
    padding: 48,
    color: '#222222',
    backgroundColor: '#FFFFFF',
  },
  header: {
    marginBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: '#1F4E79',
    borderBottomStyle: 'solid',
    paddingBottom: 12,
  },
  orgName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#1F4E79',
    marginBottom: 4,
  },
  documentTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#222222',
    marginBottom: 2,
  },
  meta: {
    fontSize: 10,
    color: '#555555',
    marginBottom: 2,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#1F4E79',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  content: {
    fontSize: 11,
    lineHeight: 1.6,
    color: '#222222',
    // Pas de rendu HTML — texte brut uniquement (SURF-5-10)
  },
  validationBox: {
    marginTop: 24,
    padding: 12,
    backgroundColor: '#E2EFDA',
    borderLeftWidth: 3,
    borderLeftColor: '#1E6B3C',
    borderLeftStyle: 'solid',
  },
  validationTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1E6B3C',
    marginBottom: 4,
  },
  validationText: {
    fontSize: 10,
    color: '#1E6B3C',
  },
  envoieBox: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#D6E4F0',
    borderLeftWidth: 3,
    borderLeftColor: '#1F4E79',
    borderLeftStyle: 'solid',
  },
  envoieText: {
    fontSize: 10,
    color: '#1F4E79',
  },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: '#CCCCCC',
    borderTopStyle: 'solid',
    paddingTop: 8,
  },
  footerText: {
    fontSize: 9,
    color: '#999999',
    textAlign: 'center',
  },
})

// ============================================================
// Helpers formatage
// ============================================================

function formatDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  const [year, month, day] = isoDate.split('T')[0]!.split('-')
  return `${day}/${month}/${year}`
}

function formatDateCr(dateCr: string): string {
  const [year, month, day] = dateCr.split('-')
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ]
  const monthIdx = parseInt(month ?? '1', 10) - 1
  return `${parseInt(day ?? '1', 10)} ${months[monthIdx] ?? ''} ${year}`
}

// ============================================================
// Composant Document
// ============================================================

/**
 * Template PDF pour un Compte Rendu journalier.
 * Rendu en texte pur via @react-pdf/renderer — aucun HTML interpolé (SURF-5-10).
 * Tous les champs sont passés comme props typées — aucune URL externe d'origine user/LLM.
 */
export function CrDocument({ cr, chantierNom, organisationNom, conducteurNom }: CrDocumentProps) {
  return (
    <Document
      title={`CR - ${chantierNom} - ${cr.date_cr}`}
      author={organisationNom}
      creator="ClawBTP"
    >
      <Page size="A4" style={styles.page}>
        {/* En-tête */}
        <View style={styles.header}>
          <Text style={styles.orgName}>{organisationNom}</Text>
          <Text style={styles.documentTitle}>Compte Rendu Journalier</Text>
          <Text style={styles.meta}>Chantier : {chantierNom}</Text>
          <Text style={styles.meta}>Date : {formatDateCr(cr.date_cr)}</Text>
          <Text style={styles.meta}>
            Déclenché par : {cr.declenche_par === 'cron' ? 'Automatique (18h)' : 'Manuel'}
          </Text>
        </View>

        {/* Contenu généré — texte brut uniquement (SURF-5-10) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compte rendu</Text>
          <Text style={styles.content}>
            {cr.contenu_genere ?? 'Contenu non disponible.'}
          </Text>
        </View>

        {/* Validation */}
        <View style={styles.validationBox}>
          <Text style={styles.validationTitle}>Validation</Text>
          <Text style={styles.validationText}>
            Validé par : {conducteurNom ?? 'Conducteur retiré'}
          </Text>
          <Text style={styles.validationText}>
            Le : {formatDate(cr.valide_at)}
          </Text>
        </View>

        {/* Envoi — visible uniquement si statut = envoye (RG-PDF-002) */}
        {cr.statut === 'envoye' && cr.envoye_at && (
          <View style={styles.envoieBox}>
            <Text style={styles.envoieText}>
              Envoyé le {formatDate(cr.envoye_at)}
            </Text>
          </View>
        )}

        {/* Pied de page */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            ClawBTP — Compte Rendu Journalier — {chantierNom} — {cr.date_cr}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
