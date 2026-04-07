#!/usr/bin/env node
/**
 * validate-json.js — Solia
 * Valide un fichier JSON prospects avant génération.
 *
 * Usage : node scripts/validate-json.js prospects/exemple.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REQUIRED_FIELDS = [
  'slug', 'prenom', 'nom', 'metier', 'ville',
  'departement', 'email', 'description', 'email_confirme'
];

const VALID_THEMES      = ['zen', 'nature', 'lumiere'];
const VALID_ZONES       = ['cabinet', 'domicile', 'les deux'];
const SLUG_PATTERN      = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_DESCRIPTION   = 30; // mots

/* ─── helpers ─── */

function wordCount(str) {
  return str.trim().split(/\s+/).length;
}

function isUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

function validateProspect(p, index) {
  const errors   = [];
  const warnings = [];
  const label    = p.slug || `prospect[${index}]`;

  // ── Champs obligatoires ──
  for (const field of REQUIRED_FIELDS) {
    if (p[field] === undefined || p[field] === null || p[field] === '') {
      errors.push(`Champ obligatoire manquant : "${field}"`);
    }
  }

  // ── email_confirme ──
  if (p.email_confirme === false) {
    warnings.push('email_confirme est false → prospect ignoré lors de la génération');
  } else if (p.email_confirme !== true && p.email_confirme !== undefined) {
    errors.push('"email_confirme" doit être un booléen (true/false)');
  }

  // ── slug ──
  if (p.slug && !SLUG_PATTERN.test(p.slug)) {
    errors.push(`"slug" invalide : "${p.slug}" (utiliser uniquement a-z, 0-9, tirets)`);
  }

  // ── email ──
  if (p.email && !EMAIL_PATTERN.test(p.email)) {
    errors.push(`"email" invalide : "${p.email}"`);
  }

  // ── description ──
  if (p.description && wordCount(p.description) < MIN_DESCRIPTION) {
    errors.push(`"description" trop courte : ${wordCount(p.description)} mots (minimum ${MIN_DESCRIPTION})`);
  }

  // ── theme ──
  if (p.theme !== undefined && !VALID_THEMES.includes(p.theme)) {
    errors.push(`"theme" invalide : "${p.theme}" (valeurs acceptées : ${VALID_THEMES.join(', ')})`);
  }

  // ── zone_intervention ──
  if (p.zone_intervention !== undefined && !VALID_ZONES.includes(p.zone_intervention)) {
    errors.push(`"zone_intervention" invalide : "${p.zone_intervention}" (valeurs : ${VALID_ZONES.join(', ')})`);
  }

  // ── URLs optionnelles ──
  const urlFields = ['photo_url', 'logo_url', 'site_actuel', 'instagram_url',
                     'facebook_url', 'linkedin_url', 'google_business_url'];
  for (const field of urlFields) {
    if (p[field] !== undefined && !isUrl(p[field])) {
      errors.push(`"${field}" n'est pas une URL valide : "${p[field]}"`);
    }
  }

  // ── types numériques ──
  if (p.avis_google_note !== undefined) {
    const n = Number(p.avis_google_note);
    if (isNaN(n) || n < 0 || n > 5) errors.push('"avis_google_note" doit être un nombre entre 0 et 5');
  }
  if (p.avis_google_nb !== undefined && (isNaN(Number(p.avis_google_nb)) || p.avis_google_nb < 0)) {
    errors.push('"avis_google_nb" doit être un entier positif');
  }
  if (p.annees_experience !== undefined && (isNaN(Number(p.annees_experience)) || p.annees_experience < 0)) {
    errors.push('"annees_experience" doit être un nombre positif');
  }

  // ── avis_google — cohérence ──
  if ((p.avis_google_note !== undefined) !== (p.avis_google_nb !== undefined)) {
    warnings.push('"avis_google_note" et "avis_google_nb" doivent être présents ensemble');
  }

  // ── arrays ──
  const arrayFields = ['langues', 'specialites', 'formations', 'certifications', 'publics'];
  for (const field of arrayFields) {
    if (p[field] !== undefined && !Array.isArray(p[field])) {
      errors.push(`"${field}" doit être un tableau (array)`);
    }
  }

  return { label, errors, warnings };
}

/* ─── main ─── */

function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage : node scripts/validate-json.js <fichier.json>');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Fichier introuvable : ${absPath}`);
    process.exit(1);
  }

  let data;
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`JSON invalide : ${e.message}`);
    process.exit(1);
  }

  const prospects = Array.isArray(data) ? data : [data];
  let totalErrors = 0;
  let totalWarnings = 0;
  let valid = 0;
  let skipped = 0;

  console.log(`\nValidation de ${prospects.length} prospect(s) — ${path.basename(absPath)}\n`);
  console.log('─'.repeat(60));

  for (let i = 0; i < prospects.length; i++) {
    const { label, errors, warnings } = validateProspect(prospects[i], i);

    if (errors.length === 0) {
      if (prospects[i].email_confirme === false) {
        skipped++;
        console.log(`⏭  [${label}] Ignoré (email_confirme: false)`);
      } else {
        valid++;
        console.log(`✓  [${label}] Valide`);
      }
    } else {
      console.log(`✗  [${label}] ${errors.length} erreur(s)`);
    }

    for (const err of errors) {
      console.log(`     ✗ ${err}`);
      totalErrors++;
    }
    for (const warn of warnings) {
      console.log(`     ⚠ ${warn}`);
      totalWarnings++;
    }
  }

  console.log('─'.repeat(60));
  console.log(`\nRésultat : ${valid} valide(s), ${skipped} ignoré(s), ${totalErrors} erreur(s), ${totalWarnings} avertissement(s)\n`);

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main();
