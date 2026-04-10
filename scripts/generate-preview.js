#!/usr/bin/env node
/**
 * generate-preview.js — Solia
 * Génère des pages d'exemple enrichies par Claude pour les prospects.
 *
 * Usage :
 *   node scripts/generate-preview.js prospects/foo.json
 *   node scripts/generate-preview.js --all        (tous sans demos/ existant)
 *
 * Variables d'environnement requises :
 *   ANTHROPIC_API_KEY
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const { spawnSync } = require('child_process');

/* ─── Config ─── */

const ROOT          = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'wellness-page.html');
const PROSPECTS_DIR = path.join(ROOT, 'prospects');
const DEMOS_DIR     = path.join(ROOT, 'demos');
const MODEL         = 'claude-sonnet-4-20250514';

/* ─── Helpers (identiques à generate-pages.js) ─── */

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

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function initiales(prenom, nom) {
  return ((prenom || '').charAt(0) + (nom || '').charAt(0)).toUpperCase() || '?';
}

function starsHtml(note) {
  const full  = Math.floor(note);
  const half  = note - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function svgStarsHtml(note) {
  const filled = Math.round(note);
  const d = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';
  let html = `<span class="svg-stars" aria-label="Note ${note} sur 5">`;
  for (let i = 0; i < 5; i++) {
    const cls = i < filled ? 'star-on' : 'star-off';
    html += `<svg class="${cls}" width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  return html + '</span>';
}

function zoneLabel(zone) {
  const map = { cabinet: 'En cabinet', domicile: 'À domicile', 'les deux': 'Cabinet & domicile' };
  return map[zone] || zone;
}

function phoneRaw(tel) {
  return tel ? tel.replace(/\s/g, '') : '';
}

const THEME_MAP = {
  zen:    ['yoga', 'massage', 'méditation', 'meditation', 'reiki', 'shiatsu', 'qi gong', 'ayurveda', 'relaxation'],
  nature: ['naturopathie', 'naturopathe', 'diététique', 'dieteticien', 'nutrition', 'nutritionniste', 'herboristerie', 'phytothérapie', 'aromathérapie']
};

function detectTheme(metier) {
  const m = metier.toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_MAP)) {
    if (keywords.some(k => m.includes(k))) return theme;
  }
  return 'lumiere';
}

function buildSchemaOrg(p) {
  const schema = {
    '@context':  'https://schema.org',
    '@type':     'LocalBusiness',
    'name':      `${p.prenom || ''} ${p.nom || ''}`.trim(),
    'description': truncate(p.description, 300),
    'address': {
      '@type':           'PostalAddress',
      'addressLocality': p.ville,
      'addressRegion':   p.departement,
      'addressCountry':  'FR'
    }
  };
  if (p.telephone) schema.telephone = p.telephone;
  if (p.adresse)   schema.address.streetAddress = p.adresse;
  if (p.photo_url) schema.image = p.photo_url;
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

/* ─── Rendu HTML (identique à generate-pages.js) ─── */

function render(template, p) {
  const theme      = p.theme || detectTheme(p.metier);
  const initAvatar = initiales(p.prenom, p.nom);
  const metaDesc   = truncate(p.description, 160);

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
    rdv_url:                !!p.rdv_url,
    adresse:                !!p.adresse,
    reseaux_sociaux:        !!(p.instagram_url || p.facebook_url || p.linkedin_url || p.google_business_url),
    departement:            !!p.departement,
    annees_experience:      !!p.annees_experience,
    langues_extra:          !!(p.langues && p.langues.length > 1),
  };

  const specialitesTags = (p.specialites || [])
    .map(s => `<span class="specialite-tag">${escapeHtml(s)}</span>`)
    .join('\n          ');

  const formationsItems = [
    ...(p.formations || []),
    ...(p.certifications || [])
  ].map(f => `<li>${escapeHtml(f)}</li>`).join('\n          ');

  const LANG_NAMES = {
    en: 'Anglais', de: 'Allemand', es: 'Espagnol', it: 'Italien',
    pt: 'Portugais', nl: 'Néerlandais', ar: 'Arabe', zh: 'Mandarin'
  };
  const languesExtra = p.langues
    ? p.langues.filter(l => l.toLowerCase() !== 'fr').map(l => LANG_NAMES[l.toLowerCase()] || l).join(', ')
    : '';

  const SOCIAL_SVG = {
    instagram_url:      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`,
    facebook_url:       `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>`,
    google_business_url:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`
  };
  const socialDefs = [
    { key: 'instagram_url',       label: 'Instagram' },
    { key: 'facebook_url',        label: 'Facebook'  },
    { key: 'google_business_url', label: 'Google'    }
  ];
  const socialLinksHtml = socialDefs
    .filter(d => p[d.key])
    .map(d => `<a href="${escapeHtml(p[d.key])}" class="social-link" target="_blank" rel="noopener">${SOCIAL_SVG[d.key]}<span>${d.label}</span></a>`)
    .join('\n          ');

  const vars = {
    prenom:               escapeHtml(p.prenom || ''),
    nom:                  escapeHtml(p.nom || ''),
    metier:               escapeHtml(p.metier),
    ville:                escapeHtml(p.ville),
    ville_display:        escapeHtml(p.ville + (p.departement ? `, ${p.departement}` : '')),
    departement:          escapeHtml(p.departement || ''),
    email:                escapeHtml(p.email || ''),
    telephone:            escapeHtml(p.telephone || ''),
    telephone_raw:        escapeHtml(phoneRaw(p.telephone)),
    adresse:              escapeHtml(p.adresse || ''),
    description:          nl2br(p.description || ''),
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
    avis_etoiles_svg:     p.avis_google_note ? svgStarsHtml(p.avis_google_note) : '',
    rdv_url:              escapeHtml(p.rdv_url || ''),
    google_business_url:  escapeHtml(p.google_business_url || ''),
    social_links_html:    socialLinksHtml
  };

  let html = template;

  // Résoudre les blocs conditionnels innermost-first
  let prev;
  do {
    prev = html;
    html = html.replace(
      /\{\{#if (\w+)\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{else\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/g,
      (_, key, truthy, falsy) => flags[key] ? truthy : falsy
    );
    html = html.replace(
      /\{\{#if (\w+)\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/g,
      (_, key, content) => flags[key] ? content : ''
    );
  } while (html !== prev);

  // Substituer les variables
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] !== undefined ? vars[key] : '');

  return html;
}

/* ─── Bandeau de prévisualisation ─── */

function injectPreviewBanner(html, slug) {
  const formUrl = `https://solia.me/formulaire/?prospect=${slug}`;

  const bannerCss = `
<style id="solia-preview-banner-style">
  #solia-preview-banner {
    position: fixed;
    top: 0; left: 0; width: 100%;
    z-index: 99999;
    background: #C4704F;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 13px 24px;
    font-family: 'DM Sans', 'Helvetica Neue', sans-serif;
    font-size: 0.88rem;
    font-weight: 500;
    letter-spacing: 0.01em;
    box-shadow: 0 2px 16px rgba(0,0,0,0.18);
    flex-wrap: wrap;
  }
  #solia-preview-banner .banner-text {
    opacity: 0.92;
  }
  #solia-preview-banner .banner-btn {
    background: #fff;
    color: #C4704F;
    font-weight: 700;
    font-size: 0.82rem;
    padding: 8px 20px;
    border-radius: 100px;
    text-decoration: none;
    white-space: nowrap;
    transition: opacity 0.2s;
    letter-spacing: 0;
  }
  #solia-preview-banner .banner-btn:hover { opacity: 0.85; }
  /* Pousse le contenu sous le bandeau */
  body { padding-top: 52px !important; }
</style>`;

  const bannerHtml = `
<div id="solia-preview-banner">
  <span class="banner-text">Ceci est un aperçu de votre future page &bull; Personnalisez-la gratuitement</span>
  <a href="${formUrl}" class="banner-btn">Personnaliser ma page →</a>
</div>`;

  // Injecte le CSS dans <head> et le bandeau juste après <body>
  html = html.replace('</head>', `${bannerCss}\n</head>`);
  html = html.replace(/<body([^>]*)>/, `<body$1>\n${bannerHtml}`);

  return html;
}

/* ─── Enrichissement Claude ─── */

const SYSTEM_PROMPT = `Tu es un rédacteur web spécialisé dans les pages vitrine pour indépendants et praticiens du bien-être.
À partir des infos fournies, génère un contenu de page professionnelle crédible et chaleureux.
Tu dois inventer des services réalistes pour ce métier, une description engageante,
et des arguments adaptés. Le ton est professionnel mais humain et accessible.
Optimise pour le SEO local : inclus la ville et le métier naturellement dans les textes.
Réponds UNIQUEMENT en JSON valide, sans markdown, sans bloc de code, sans commentaire.`;

const USER_PROMPT_TEMPLATE = (p) => `
Praticien : ${p.metier} à ${p.ville}${p.departement ? ` (${p.departement})` : ''}
${p.avis_google_note ? `Note Google : ${p.avis_google_note}/5 (${p.avis_google_nb} avis)` : ''}
${p.telephone ? `Téléphone : ${p.telephone}` : ''}
${p.adresse ? `Adresse : ${p.adresse}` : ''}
${p.horaires ? `Horaires : ${p.horaires}` : ''}

Génère le contenu JSON pour sa page vitrine avec cette structure exacte :
{
  "titre": "phrase d'accroche courte et percutante incluant le métier (max 10 mots)",
  "description": "présentation engageante en 3-4 phrases, ton chaleureux, inclut la ville",
  "approche": "description de l'approche et de la méthode de travail, 2-3 phrases",
  "specialites": ["spécialité 1", "spécialité 2", "spécialité 3", "spécialité 4", "spécialité 5"],
  "arguments": ["argument différenciateur 1", "argument 2", "argument 3"],
  "meta_description": "description SEO pour Google, max 155 caractères, inclut métier + ville",
  "meta_title": "${p.metier} à ${p.ville} — [Titre accrocheur]"
}
`.trim();

function enrichWithClaude(prospect) {
  console.log(`  → Appel Claude (${MODEL})...`);

  // curl est utilisé directement (pas fetch/SDK) car le proxy réseau de cet
  // environnement bloque les connexions Node.js vers api.anthropic.com.
  // spawnSync sans shell = pas d'injection possible.
  const result = spawnSync('curl', [
    '-s', '--max-time', '45',
    '-X', 'POST',
    '-H', `x-api-key: ${process.env.ANTHROPIC_API_KEY}`,
    '-H', 'anthropic-version: 2023-06-01',
    '-H', 'content-type: application/json',
    '-d', JSON.stringify({
      model:      MODEL,
      max_tokens: 1200,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: USER_PROMPT_TEMPLATE(prospect) }],
    }),
    'https://api.anthropic.com/v1/messages',
  ], { encoding: 'utf8', timeout: 50000 });

  if (result.error) throw new Error(`curl : ${result.error.message}`);
  if (result.status !== 0) throw new Error(`curl exit ${result.status} : ${result.stderr}`);

  let resp;
  try {
    resp = JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(`Réponse non-JSON : ${result.stdout.slice(0, 200)}`);
  }

  if (resp.error) throw new Error(`Anthropic API : ${resp.error.message}`);

  const raw   = resp.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Claude n'a pas retourné de JSON valide :\n${raw}`);

  let enriched;
  try {
    enriched = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`JSON malformé depuis Claude : ${e.message}`);
  }

  return enriched;
}

/* ─── Génération d'une page preview ─── */

async function generatePreviewPage(prospect, template) {
  const slug    = prospect.slug;
  const outDir  = path.join(DEMOS_DIR, slug);
  const outFile = path.join(outDir, 'index.html');

  console.log(`\n📄 ${slug}`);
  console.log(`   ${prospect.metier} — ${prospect.ville}`);

  // Enrichissement Claude
  let enriched;
  try {
    enriched = enrichWithClaude(prospect);
  } catch (err) {
    console.error(`  ✗ Erreur Claude : ${err.message}`);
    return { slug, status: 'error', reason: err.message };
  }

  console.log(`  ✓ Enrichissement reçu : "${enriched.titre}"`);

  // Fusionner l'enrichissement dans le prospect
  const merged = {
    ...prospect,
    description:      enriched.description       || prospect.description || '',
    approche:         enriched.approche          || prospect.approche    || '',
    specialites:      enriched.specialites       || prospect.specialites || [],
    // Garder email vide pour preview, la validation n'est pas requise ici
    email:            prospect.email             || '',
    email_confirme:   prospect.email_confirme    || false,
  };

  // Metadata SEO depuis Claude
  const metaTitle = enriched.meta_title || `${prospect.metier} à ${prospect.ville}`;
  const metaDesc  = enriched.meta_description || '';

  // Rendre le HTML via le template existant
  let html = render(template, merged);

  // Remplacer le <title> par le meta_title Claude
  if (metaTitle) {
    html = html.replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeHtml(metaTitle)}</title>`
    );
  }

  // Injecter le bandeau de prévisualisation
  html = injectPreviewBanner(html, slug);

  // Écrire le fichier
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');

  const relPath = path.relative(ROOT, outFile);
  console.log(`  ✓ Généré → ${relPath}`);

  return { slug, status: 'generated', path: relPath, titre: enriched.titre };
}

/* ─── Chargement des prospects ─── */

function loadProspect(filePath) {
  const abs  = path.resolve(filePath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return Array.isArray(data) ? data : [data];
}

function loadAllProspectsWithoutDemo() {
  const files = fs.readdirSync(PROSPECTS_DIR).filter(f => f.endsWith('.json'));
  const all   = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PROSPECTS_DIR, f), 'utf8'));
      const items = Array.isArray(data) ? data : [data];
      for (const p of items) {
        if (!p.slug) continue;
        const demoExists = fs.existsSync(path.join(DEMOS_DIR, p.slug, 'index.html'));
        if (!demoExists) all.push(p);
      }
    } catch {}
  }
  return all;
}

/* ─── main ─── */

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('✗ Variable ANTHROPIC_API_KEY manquante');
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`✗ Template introuvable : ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const isAll    = process.argv.includes('--all');
  const filePath = process.argv.find(a => !a.startsWith('-') && a.endsWith('.json'));

  let prospects = [];

  if (isAll) {
    prospects = loadAllProspectsWithoutDemo();
    console.log(`\nSolia Preview — mode batch`);
    console.log(`${prospects.length} prospect(s) sans page demo trouvés`);
  } else if (filePath) {
    prospects = loadProspect(filePath);
    console.log(`\nSolia Preview — ${path.basename(filePath)}`);
    console.log(`${prospects.length} prospect(s) à traiter`);
  } else {
    console.error('Usage : node scripts/generate-preview.js <prospects/foo.json>');
    console.error('        node scripts/generate-preview.js --all');
    process.exit(1);
  }

  console.log('─'.repeat(60));

  const results = [];
  for (const prospect of prospects) {
    const result = await generatePreviewPage(prospect, template);
    results.push(result);
  }

  // Résumé
  const generated = results.filter(r => r.status === 'generated');
  const errors    = results.filter(r => r.status === 'error');

  console.log('\n' + '─'.repeat(60));
  console.log(`\n✓ ${generated.length} page(s) générée(s)`);
  if (errors.length) {
    console.log(`✗ ${errors.length} erreur(s) :`);
    for (const e of errors) console.log(`  - ${e.slug} : ${e.reason}`);
  }
}

main().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
