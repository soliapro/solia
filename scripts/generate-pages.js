#!/usr/bin/env node
/**
 * generate-pages.js — Solia
 * Pipeline JSON → HTML : génère une page par prospect valide.
 *
 * Usage :
 *   node scripts/generate-pages.js prospects/exemple.json
 *   node scripts/generate-pages.js prospects/exemple.json --force
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/* ─── Config ─── */

const ROOT          = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'wellness-page.html');
const DEMOS_DIR     = path.join(ROOT, 'demos');
const REPORT_PATH   = path.join(ROOT, 'REPORT.md');
const FORCE         = process.argv.includes('--force');

/* ─── Thème auto selon le métier ─── */

const THEME_MAP = {
  zen:    ['yoga', 'massage', 'méditation', 'meditation', 'reiki', 'shiatsu', 'qi gong',
           'ayurveda', 'yin', 'relaxation'],
  nature: ['naturopathie', 'naturopathe', 'diététique', 'dieteticien', 'diététicien',
           'nutrition', 'nutritionniste', 'herboristerie', 'herboriste', 'phytothérapie',
           'aromathérapie', 'homéopathie']
};

function detectTheme(metier) {
  const m = metier.toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_MAP)) {
    if (keywords.some(k => m.includes(k))) return theme;
  }
  return 'lumiere';
}

/* ─── Helpers ─── */

function initiales(prenom, nom) {
  return ((prenom || '').charAt(0) + (nom || '').charAt(0)).toUpperCase();
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function starsHtml(note) {
  const full  = Math.floor(note);
  const half  = note - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function zoneLabel(zone) {
  const map = { cabinet: 'En cabinet', domicile: 'À domicile', 'les deux': 'Cabinet & domicile' };
  return map[zone] || zone;
}

function phoneRaw(tel) {
  return tel ? tel.replace(/\s/g, '') : '';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(str) {
  return escapeHtml(str).replace(/\n/g, '<br>');
}

/* ─── Validation minimale ─── */

const REQUIRED = ['slug', 'prenom', 'nom', 'metier', 'ville', 'departement', 'email', 'description', 'email_confirme'];

function isValid(p) {
  for (const f of REQUIRED) {
    if (p[f] === undefined || p[f] === null || p[f] === '') return false;
  }
  return p.email_confirme === true;
}

/* ─── Schema.org JSON-LD ─── */

function buildSchemaOrg(p) {
  const schema = {
    '@context':  'https://schema.org',
    '@type':     'LocalBusiness',
    'name':      `${p.prenom} ${p.nom}`,
    'description': truncate(p.description, 300),
    'address': {
      '@type':           'PostalAddress',
      'addressLocality': p.ville,
      'addressRegion':   p.departement,
      'addressCountry':  'FR'
    },
    'email': p.email,
    'priceRange': p.tarif || undefined
  };

  if (p.telephone) schema.telephone = p.telephone;
  if (p.adresse)   schema['address']['streetAddress'] = p.adresse;
  if (p.photo_url) schema.image = p.photo_url;
  if (p.site_actuel) schema.url = p.site_actuel;

  if (p.avis_google_note && p.avis_google_nb) {
    schema.aggregateRating = {
      '@type':       'AggregateRating',
      'ratingValue': p.avis_google_note,
      'reviewCount': p.avis_google_nb,
      'bestRating':  5
    };
  }

  return JSON.stringify(schema, null, 2);
}

/* ─── Injection du template ─── */

function render(template, p) {
  const theme   = p.theme || detectTheme(p.metier);
  const initAvatar = initiales(p.prenom, p.nom);
  const metaDesc   = truncate(p.description, 160);

  // Flags booléens pour les blocs {{#if}}
  const flags = {
    photo_url:              !!p.photo_url,
    approche:               !!p.approche,
    specialites:            !!(p.specialites && p.specialites.length),
    duree_seance:           !!p.duree_seance,
    zone_intervention:      !!p.zone_intervention,
    publics:                !!(p.publics && p.publics.length),
    formations_ou_certifications: !!(
      (p.formations && p.formations.length) ||
      (p.certifications && p.certifications.length)
    ),
    avis_google:            !!(p.avis_google_note && p.avis_google_nb),
    google_business_url:    !!p.google_business_url,
    telephone:              !!p.telephone,
    adresse:                !!p.adresse,
    reseaux_sociaux:        !!(p.instagram_url || p.facebook_url || p.linkedin_url || p.google_business_url),
    departement:            !!p.departement,
    annees_experience:      !!p.annees_experience,
    langues_extra:          !!(p.langues && p.langues.length > 1),
  };

  // Spécialités → tags HTML
  const specialitesTags = (p.specialites || [])
    .map(s => `<span class="specialite-tag">${escapeHtml(s)}</span>`)
    .join('\n          ');

  // Formations + certifications → <li>
  const formationsItems = [
    ...(p.formations || []),
    ...(p.certifications || [])
  ].map(f => `<li>${escapeHtml(f)}</li>`).join('\n          ');

  // Langues affichées (sauf fr)
  const languesExtra = p.langues
    ? p.langues.filter(l => l.toLowerCase() !== 'fr').join(', ')
    : '';

  // Réseaux sociaux
  const socialDefs = [
    { key: 'instagram_url',      label: 'Instagram',      icon: '📸' },
    { key: 'facebook_url',       label: 'Facebook',       icon: '📘' },
    { key: 'linkedin_url',       label: 'LinkedIn',       icon: '💼' },
    { key: 'google_business_url', label: 'Google',        icon: '🔍' },
    { key: 'site_actuel',        label: 'Mon site',       icon: '🌐' }
  ];
  const socialLinksHtml = socialDefs
    .filter(d => p[d.key])
    .map(d => `<a href="${escapeHtml(p[d.key])}" class="social-link" target="_blank" rel="noopener">${d.icon} ${d.label}</a>`)
    .join('\n          ');

  // Substitutions simples
  const vars = {
    prenom:               escapeHtml(p.prenom),
    nom:                  escapeHtml(p.nom),
    metier:               escapeHtml(p.metier),
    ville:                escapeHtml(p.ville),
    departement:          escapeHtml(p.departement || ''),
    email:                escapeHtml(p.email),
    telephone:            escapeHtml(p.telephone || ''),
    telephone_raw:        escapeHtml(phoneRaw(p.telephone)),
    adresse:              escapeHtml(p.adresse || ''),
    description:          nl2br(p.description),
    approche:             nl2br(p.approche || ''),
    photo_url:            escapeHtml(p.photo_url || ''),
    theme,
    initiales:            initAvatar,
    meta_description:     escapeHtml(metaDesc),
    schema_org:           buildSchemaOrg(p),
    tarif_display:        escapeHtml(p.tarif || 'Tarifs sur demande'),
    horaires_display:     escapeHtml(p.horaires || 'Sur rendez-vous — contactez-moi'),
    duree_seance:         escapeHtml(p.duree_seance || ''),
    zone_intervention:    escapeHtml(p.zone_intervention || ''),
    zone_intervention_label: escapeHtml(zoneLabel(p.zone_intervention || '')),
    publics_display:      escapeHtml((p.publics || []).join(', ')),
    annees_experience:    String(p.annees_experience || ''),
    langues_extra:        escapeHtml(languesExtra),
    specialites_tags:     specialitesTags,
    formations_items:     formationsItems,
    avis_google_note:     String(p.avis_google_note || ''),
    avis_google_nb:       String(p.avis_google_nb || ''),
    avis_etoiles:         p.avis_google_note ? starsHtml(p.avis_google_note) : '',
    google_business_url:  escapeHtml(p.google_business_url || ''),
    social_links_html:    socialLinksHtml
  };

  let html = template;

  // 1. Résoudre les blocs conditionnels (itératif pour gérer l'imbrication)
  //    Traite d'abord {{#if}}...{{else}}...{{/if}}, puis {{#if}}...{{/if}}
  //    Répète jusqu'à stabilisation (pour les blocs imbriqués).
  let prev;
  do {
    prev = html;
    html = html.replace(
      /\{\{#if (\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, key, truthy, falsy) => flags[key] ? truthy : falsy
    );
    html = html.replace(
      /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, key, content) => flags[key] ? content : ''
    );
  } while (html !== prev);

  // 2. Substituer les variables {{clé}}
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? vars[key] : '';
  });

  return html;
}

/* ─── Génération ─── */

function generatePage(p, template) {
  const outDir  = path.join(DEMOS_DIR, p.slug);
  const outFile = path.join(outDir, 'index.html');

  if (fs.existsSync(outFile) && !FORCE) {
    return { slug: p.slug, status: 'skipped', reason: 'existe déjà (utilisez --force)' };
  }

  fs.mkdirSync(outDir, { recursive: true });

  const html = render(template, p);
  fs.writeFileSync(outFile, html, 'utf8');

  return { slug: p.slug, status: 'generated', path: path.relative(ROOT, outFile) };
}

/* ─── Rapport ─── */

function writeReport(results, filePath, startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const now     = new Date().toLocaleString('fr-FR');
  const generated = results.filter(r => r.status === 'generated');
  const skipped   = results.filter(r => r.status === 'skipped');
  const invalid   = results.filter(r => r.status === 'invalid');

  const lines = [
    `# Rapport Solia`,
    ``,
    `**Généré le** : ${now}  `,
    `**Source** : \`${path.relative(ROOT, path.resolve(filePath))}\`  `,
    `**Durée** : ${elapsed}s`,
    ``,
    `---`,
    ``,
    `## Résumé`,
    ``,
    `| Statut | Nombre |`,
    `|--------|--------|`,
    `| ✓ Générées | ${generated.length} |`,
    `| ⏭ Ignorées | ${skipped.length} |`,
    `| ✗ Invalides | ${invalid.length} |`,
    `| **Total** | **${results.length}** |`,
    ``
  ];

  if (generated.length) {
    lines.push('## Pages générées', '');
    for (const r of generated) {
      lines.push(`- [\`${r.slug}\`](${r.path})`);
    }
    lines.push('');
  }

  if (skipped.length) {
    lines.push('## Pages ignorées', '');
    for (const r of skipped) {
      lines.push(`- \`${r.slug}\` — ${r.reason}`);
    }
    lines.push('');
  }

  if (invalid.length) {
    lines.push('## Erreurs de validation', '');
    for (const r of invalid) {
      lines.push(`- \`${r.slug || r.index}\` — ${r.reason}`);
    }
    lines.push('');
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
}

/* ─── main ─── */

function main() {
  const start    = Date.now();
  const filePath = process.argv.find(a => !a.startsWith('-') && a.endsWith('.json'));

  if (!filePath) {
    console.error('Usage : node scripts/generate-pages.js <fichier.json> [--force]');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Fichier introuvable : ${absPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`Template introuvable : ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (e) {
    console.error(`JSON invalide : ${e.message}`);
    process.exit(1);
  }

  const prospects = Array.isArray(data) ? data : [data];
  console.log(`\nSolia — génération de pages`);
  console.log(`Source : ${path.relative(ROOT, absPath)}`);
  console.log(`Prospects : ${prospects.length}${FORCE ? ' (mode --force)' : ''}`);
  console.log('─'.repeat(50));

  const results = [];

  for (let i = 0; i < prospects.length; i++) {
    const p = prospects[i];

    if (!isValid(p)) {
      const reason = p.email_confirme === false
        ? 'email_confirme: false'
        : 'champs obligatoires manquants';
      const label = p.slug || `[${i}]`;
      results.push({ slug: label, index: i, status: 'invalid', reason });
      console.log(`✗ ${label} — ${reason}`);
      continue;
    }

    const result = generatePage(p, template);
    results.push(result);

    if (result.status === 'generated') {
      console.log(`✓ ${result.slug} → ${result.path}`);
    } else {
      console.log(`⏭ ${result.slug} — ${result.reason}`);
    }
  }

  writeReport(results, filePath, start);

  const generated = results.filter(r => r.status === 'generated').length;
  const elapsed   = ((Date.now() - start) / 1000).toFixed(2);

  console.log('─'.repeat(50));
  console.log(`\n${generated} page(s) générée(s) en ${elapsed}s`);
  console.log(`Rapport : REPORT.md\n`);
}

main();
