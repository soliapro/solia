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
const REQUIRED_DEMO = ['slug', 'metier', 'ville'];

function isValid(p) {
  // page_active = true → mode démo (moins de champs requis, fallbacks auto)
  if (p.page_active === true) {
    for (const f of REQUIRED_DEMO) {
      if (!p[f]) return false;
    }
    return true;
  }
  for (const f of REQUIRED) {
    if (p[f] === undefined || p[f] === null || p[f] === '') return false;
  }
  return p.email_confirme === true;
}

function applyDemoFallbacks(p) {
  const name = [p.prenom, p.nom].filter(Boolean).join(' ') || p.metier;
  if (!p.description) {
    p.description = `${name}, ${p.metier.toLowerCase()} à ${p.ville}. Prenez rendez-vous pour une consultation personnalisée.`;
  }
  if (!p.prenom) p.prenom = '';
  if (!p.nom) p.nom = p.metier;
  if (!p.departement) p.departement = '';
  if (!p.email) p.email = '';
  return p;
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
    rdv_url:                !!p.rdv_url,
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

  // Langues affichées (sauf fr) — codes ISO → noms complets
  const LANG_NAMES = {
    en: 'Anglais', de: 'Allemand', es: 'Espagnol', it: 'Italien',
    pt: 'Portugais', nl: 'Néerlandais', ar: 'Arabe', zh: 'Mandarin',
    ja: 'Japonais', ru: 'Russe', pl: 'Polonais', tr: 'Turc'
  };
  const languesExtra = p.langues
    ? p.langues
        .filter(l => l.toLowerCase() !== 'fr')
        .map(l => LANG_NAMES[l.toLowerCase()] || l)
        .join(', ')
    : '';

  // Réseaux sociaux — icônes SVG inline
  const SOCIAL_SVG = {
    instagram_url:      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`,
    facebook_url:       `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>`,
    linkedin_url:       `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>`,
    google_business_url:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    site_actuel:        `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>`
  };
  const socialDefs = [
    { key: 'instagram_url',       label: 'Instagram' },
    { key: 'facebook_url',        label: 'Facebook'  },
    { key: 'linkedin_url',        label: 'LinkedIn'  },
    { key: 'google_business_url', label: 'Google'    },
    { key: 'site_actuel',         label: 'Mon site'  }
  ];
  const socialLinksHtml = socialDefs
    .filter(d => p[d.key])
    .map(d => `<a href="${escapeHtml(p[d.key])}" class="social-link" target="_blank" rel="noopener">${SOCIAL_SVG[d.key]}<span>${d.label}</span></a>`)
    .join('\n          ');

  // Substitutions simples
  const vars = {
    prenom:               escapeHtml(p.prenom),
    nom:                  escapeHtml(p.nom),
    metier:               escapeHtml(p.metier),
    ville:                escapeHtml(p.ville),
    ville_display:        escapeHtml(p.ville + (p.departement ? `, ${p.departement}` : '')),
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
    avis_etoiles_svg:     p.avis_google_note ? svgStarsHtml(p.avis_google_note) : '',
    rdv_url:              escapeHtml(p.rdv_url || ''),
    google_business_url:  escapeHtml(p.google_business_url || ''),
    social_links_html:    socialLinksHtml
  };

  let html = template;

  // 1. Résoudre les blocs conditionnels — innermost-first.
  //    Le lookahead négatif (?!\{\{#if) garantit qu'on ne traite que les blocs
  //    qui ne contiennent pas de {{#if}} imbriqué. La boucle do/while répète
  //    jusqu'à stabilisation, résolvant les niveaux de l'intérieur vers l'extérieur.
  let prev;
  do {
    prev = html;
    // Blocs avec {{else}} sans {{#if}} imbriqué à l'intérieur
    html = html.replace(
      /\{\{#if (\w+)\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{else\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/g,
      (_, key, truthy, falsy) => flags[key] ? truthy : falsy
    );
    // Blocs sans {{else}} et sans {{#if}} imbriqué
    html = html.replace(
      /\{\{#if (\w+)\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/g,
      (_, key, content) => flags[key] ? content : ''
    );
  } while (html !== prev);

  // 2. Substituer les variables {{clé}}
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? vars[key] : '';
  });

  return html;
}

/* ─── Bandeau preview (pages démo) ─── */

function injectPreviewBanner(html, slug) {
  const formUrl = `https://solia.me/formulaire/?prospect=${slug}`;

  const bannerCss = `
<style id="solia-preview-banner-style">
  #solia-preview-banner {
    position: fixed; top: 0; left: 0; width: 100%; z-index: 99999;
    background: #1A1A18; color: #fff;
    display: flex; align-items: center; justify-content: center;
    gap: 12px; padding: 10px 16px;
    font-family: 'DM Sans', 'Helvetica Neue', sans-serif;
    font-size: 0.78rem; font-weight: 500;
    box-shadow: 0 2px 16px rgba(0,0,0,0.18);
  }
  #solia-preview-banner .banner-btn {
    background: #C4704F; color: #fff; font-weight: 700; font-size: 0.72rem;
    padding: 6px 14px; border-radius: 100px; text-decoration: none;
    white-space: nowrap; transition: opacity 0.2s; flex-shrink: 0;
  }
  #solia-preview-banner .banner-btn:hover { opacity: 0.85; }
  .banner-text { white-space: nowrap; }
  .theme-dots { display: flex; gap: 5px; align-items: center; flex-shrink: 0; }
  .theme-dots span { font-size: 0.68rem; color: rgba(255,255,255,0.5); }
  .theme-dot-btn {
    width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.25);
    cursor: pointer; transition: border-color 0.2s, transform 0.15s; flex-shrink: 0;
  }
  .theme-dot-btn:hover { transform: scale(1.15); }
  .theme-dot-btn.active { border-color: #fff; transform: scale(1.15); }
  body { padding-top: 42px !important; }
  @media (max-width: 600px) {
    #solia-preview-banner { gap: 8px; padding: 8px 12px; font-size: 0.72rem; }
    .banner-text { display: none; }
    .theme-dot-btn { width: 22px; height: 22px; }
    body { padding-top: 40px !important; }
  }
</style>`;

  const bannerHtml = `
<div id="solia-preview-banner">
  <span class="banner-text">Aperçu</span>
  <div class="theme-dots">
    <span>Thème</span>
    <div class="theme-dot-btn" data-t="terracotta" style="background:#C4704F" title="Terracotta"></div>
    <div class="theme-dot-btn" data-t="sauge" style="background:#6B8F5E" title="Sauge"></div>
    <div class="theme-dot-btn" data-t="ocean" style="background:#2E6B8A" title="Océan"></div>
    <div class="theme-dot-btn" data-t="lavande" style="background:#8B6DAF" title="Lavande"></div>
    <div class="theme-dot-btn" data-t="charbon" style="background:#3D3D3D" title="Charbon"></div>
  </div>
  <a href="${formUrl}" class="banner-btn" id="banner-cta">Personnaliser ma page →</a>
</div>
<script>
(function(){
  var slug = '${slug}';
  var current = document.documentElement.getAttribute('data-theme') || 'terracotta';
  var stored = localStorage.getItem('solia_theme_' + slug);
  if (stored) { current = stored; document.documentElement.setAttribute('data-theme', current); }
  document.querySelectorAll('.theme-dot-btn').forEach(function(d){
    if (d.dataset.t === current) d.classList.add('active');
    d.addEventListener('click', function(){
      var t = d.dataset.t;
      document.documentElement.setAttribute('data-theme', t);
      document.querySelectorAll('.theme-dot-btn').forEach(function(x){ x.classList.remove('active'); });
      d.classList.add('active');
      localStorage.setItem('solia_theme_' + slug, t);
      document.getElementById('banner-cta').href = '${formUrl}&theme=' + t;
    });
  });
  document.getElementById('banner-cta').href = '${formUrl}&theme=' + current;
})();
</script>`;

  html = html.replace('</head>', `${bannerCss}\n</head>`);
  html = html.replace(/<body([^>]*)>/, `<body$1>\n${bannerHtml}`);
  return html;
}

/* ─── Génération ─── */

function generatePage(p, template) {
  const isDemo = p.page_active === true && p.email_confirme !== true;

  // Appliquer les fallbacks pour les pages démo
  if (isDemo) applyDemoFallbacks(p);

  const outDir  = path.join(DEMOS_DIR, p.slug);
  const outFile = path.join(outDir, 'index.html');

  if (fs.existsSync(outFile) && !FORCE) {
    return { slug: p.slug, status: 'skipped', reason: 'existe déjà (utilisez --force)' };
  }

  fs.mkdirSync(outDir, { recursive: true });

  let html = render(template, p);

  // Injecter le bandeau preview pour les pages démo
  if (isDemo) html = injectPreviewBanner(html, p.slug);

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
