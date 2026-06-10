// lib/reporting/pdf/HebdoDocument.tsx — Template PDF Rapport Hebdomadaire
// D-5-07 : @react-pdf/renderer, renderToBuffer côté handler Node
// RG-PDF-002 BINDING : org, chantier, plage semaine ISO, contenu, conducteur, valide_at
// SURF-5-10 : contenu rendu en texte pur uniquement (sécurité anti-XSS)

import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { RapportHebdo } from '@/types/reporting'
import { getWeekBounds, formatSemaineLabel } from '@/lib/reporting/isoWeek'

// ============================================================
// Types props
// ============================================================

export interface HebdoDocumentProps {
  rapport: RapportHebdo
  chantierNom: string
  organisationNom: string
  conducteurNom: string | null
}

// ============================================================
// Styles (cohérents avec CrDocument)
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
  crsCountBox: {
    marginBottom: 12,
    padding: 8,
    backgroundColor: '#F2F2F2',
  },
  crsCountText: {
    fontSize: 10,
    color: '#555555',
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
// Helpers
// ============================================================

function formatDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  const [year, month, day] = isoDate.split('T')[0]!.split('-')
  return `${day}/${month}/${year}`
}

// ============================================================
// Composant Document
// ============================================================

/**
 * Template PDF pour un Rapport Hebdomadaire.
 * Rendu en texte pur via @react-pdf/renderer — aucun HTML interpolé (SURF-5-10).
 * Nom de fichier : RapportHebdo-[chantier]-S[N]-[AAAA].pdf (buildHebdoFilename)
 */
export function HebdoDocument({
  rapport,
  chantierNom,
  organisationNom,
  conducteurNom,
}: HebdoDocumentProps) {
  const { lundi, dimanche } = getWeekBounds(rapport.annee_iso, rapport.semaine_iso)
  const semaineLabel = formatSemaineLabel(rapport.annee_iso, rapport.semaine_iso)

  return (
    <Document
      title={`Rapport Hebdo - ${chantierNom} - S${rapport.semaine_iso} ${rapport.annee_iso}`}
      author={organisationNom}
      creator="ClawBTP"
    >
      <Page size="A4" style={styles.page}>
        {/* En-tête */}
        <View style={styles.header}>
          <Text style={styles.orgName}>{organisationNom}</Text>
          <Text style={styles.documentTitle}>Rapport Hebdomadaire</Text>
          <Text style={styles.meta}>Chantier : {chantierNom}</Text>
          <Text style={styles.meta}>{semaineLabel}</Text>
          <Text style={styles.meta}>Période : du {formatDate(lundi + 'T00:00:00Z')} au {formatDate(dimanche + 'T00:00:00Z')}</Text>
        </View>

        {/* Nombre de CRs source */}
        <View style={styles.crsCountBox}>
          <Text style={styles.crsCountText}>
            Synthèse basée sur {rapport.cr_ids.length} compte(s) rendu(s) journalier(s) validé(s).
          </Text>
        </View>

        {/* Contenu généré — texte brut uniquement (SURF-5-10) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Synthèse hebdomadaire</Text>
          <Text style={styles.content}>
            {rapport.contenu_genere ?? 'Contenu non disponible.'}
          </Text>
        </View>

        {/* Validation */}
        <View style={styles.validationBox}>
          <Text style={styles.validationTitle}>Validation</Text>
          <Text style={styles.validationText}>
            Validé par : {conducteurNom ?? 'Conducteur retiré'}
          </Text>
          <Text style={styles.validationText}>
            Le : {formatDate(rapport.valide_at)}
          </Text>
        </View>

        {/* Envoi */}
        {rapport.statut === 'envoye' && rapport.envoye_at && (
          <View style={styles.envoieBox}>
            <Text style={styles.envoieText}>
              Envoyé le {formatDate(rapport.envoye_at)}
            </Text>
          </View>
        )}

        {/* Pied de page */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            ClawBTP — Rapport Hebdomadaire — {chantierNom} — S{rapport.semaine_iso} {rapport.annee_iso}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
