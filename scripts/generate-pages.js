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

function injectPreviewBanner(html, slug, demoCreatedAt) {
  const formUrl  = `https://solia.me/formulaire/?prospect=${slug}`;
  const stripeUrl = `https://buy.stripe.com/28E4gAd7XawU2xl0WA67S0a?client_reference_id=${slug}`;
  const created  = demoCreatedAt || new Date().toISOString();

  const bannerCss = `
<style id="solia-preview-banner-style">
  #solia-preview-banner {
    position: fixed; top: 0; left: 0; width: 100%; z-index: 99999;
    background: #1A1A18; color: #fff;
    display: flex; align-items: center; justify-content: center;
    gap: 10px; padding: 9px 16px;
    font-family: 'DM Sans', 'Helvetica Neue', sans-serif;
    font-size: 0.75rem; font-weight: 500;
    box-shadow: 0 2px 16px rgba(0,0,0,0.18);
  }
  .banner-btn {
    font-weight: 700; font-size: 0.7rem;
    padding: 5px 13px; border-radius: 100px; text-decoration: none;
    white-space: nowrap; transition: opacity 0.2s; flex-shrink: 0;
  }
  .banner-btn-secondary { background: rgba(255,255,255,0.15); color: #fff; }
  .banner-btn-primary { background: #C4704F; color: #fff; }
  .banner-btn:hover { opacity: 0.85; }
  .banner-countdown { color: rgba(255,255,255,0.6); white-space: nowrap; font-size: 0.68rem; flex-shrink: 0; }
  .theme-dots { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
  .theme-dot-btn {
    width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2);
    cursor: pointer; transition: border-color 0.2s, transform 0.15s; flex-shrink: 0;
  }
  .theme-dot-btn:hover { transform: scale(1.15); }
  .theme-dot-btn.active { border-color: #fff; transform: scale(1.15); }
  body { padding-top: 40px !important; }
  @media (max-width: 640px) {
    #solia-preview-banner { gap: 6px; padding: 7px 10px; }
    .banner-btn { font-size: 0.65rem; padding: 5px 10px; }
    .theme-dot-btn { width: 18px; height: 18px; }
    body { padding-top: 38px !important; }
  }
  #solia-expired-overlay {
    display: none; position: fixed; inset: 0; z-index: 999999;
    background: rgba(253,250,246,0.96); backdrop-filter: blur(8px);
    flex-direction: column; align-items: center; justify-content: center;
    gap: 20px; text-align: center; padding: 32px;
    font-family: 'DM Sans', sans-serif;
  }
  #solia-expired-overlay.visible { display: flex; }
  .expired-title { font-family: 'Playfair Display', serif; font-size: 1.5rem; font-weight: 600; color: #1A1A18; }
  .expired-sub { font-size: 0.9rem; color: #8A8074; max-width: 380px; line-height: 1.6; }
  .expired-btn { background: #C4704F; color: #fff; font-weight: 700; font-size: 0.9rem; padding: 14px 32px; border-radius: 100px; text-decoration: none; }
  .expired-btn:hover { background: #A85C3E; }
  .expired-link { font-size: 0.82rem; color: #8A8074; }

  [data-photo-upload] { position: relative; }
  #photo-file-input { display: none; }

  /* Social editor panel */
  .social-editor-btn { background:rgba(255,255,255,0.15); color:#fff; border:none; padding:5px 10px; border-radius:100px; font-size:0.65rem; font-weight:600; cursor:pointer; font-family:'DM Sans',sans-serif; white-space:nowrap; }
  .social-editor-btn:hover { background:rgba(255,255,255,0.25); }
  #social-panel {
    display:none; position:fixed; top:44px; right:16px; z-index:99998;
    background:#fff; border-radius:14px; box-shadow:0 8px 32px rgba(0,0,0,0.18);
    padding:20px; width:320px; max-width:calc(100vw - 32px);
    font-family:'DM Sans',sans-serif;
  }
  #social-panel.visible { display:block; }
  #social-panel h3 { font-size:0.88rem; font-weight:600; margin-bottom:12px; color:#1A1A18; }
  .social-field { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
  .social-field label { font-size:0.72rem; font-weight:600; color:#8A8074; width:70px; flex-shrink:0; }
  .social-field input { flex:1; border:1.5px solid #E4DDD4; border-radius:8px; padding:7px 10px; font-size:0.78rem; font-family:'DM Sans',sans-serif; outline:none; color:#1A1A18; }
  .social-field input:focus { border-color:#C4704F; }
  .social-field input::placeholder { color:#E4DDD4; }
  .social-save { background:#C4704F; color:#fff; border:none; padding:8px 20px; border-radius:100px; font-size:0.78rem; font-weight:700; cursor:pointer; width:100%; margin-top:4px; font-family:'DM Sans',sans-serif; }
</style>`;

  const bannerHtml = `
<div id="solia-preview-banner">
  <div class="theme-dots">
    <div class="theme-dot-btn" data-t="terracotta" style="background:#C4704F" title="Terracotta"></div>
    <div class="theme-dot-btn" data-t="sauge" style="background:#6B8F5E" title="Sauge"></div>
    <div class="theme-dot-btn" data-t="ocean" style="background:#2E6B8A" title="Océan"></div>
    <div class="theme-dot-btn" data-t="lavande" style="background:#8B6DAF" title="Lavande"></div>
    <div class="theme-dot-btn" data-t="charbon" style="background:#3D3D3D" title="Charbon"></div>
  </div>
  <span class="banner-countdown" id="banner-countdown"></span>
  <button class="banner-btn banner-btn-secondary" id="edit-toggle">Modifier</button>
  <a href="${stripeUrl}" class="banner-btn banner-btn-primary">Publier ma page</a>
</div>

<div id="solia-expired-overlay">
  <div class="expired-title">Votre essai a expiré</div>
  <div class="expired-sub">Votre page de démonstration n'est plus disponible. Publiez-la pour la garder en ligne.</div>
  <a href="${stripeUrl}" class="expired-btn">Publier ma page →</a>
  <a href="mailto:damien.reiss@gmail.com?subject=Page%20Solia%20—%20${slug}" class="expired-link">Nous contacter</a>
</div>

<script>
(function(){
  var slug = '${slug}';
  var created = new Date('${created}');
  var expires = new Date(created.getTime() + 7*24*60*60*1000);
  var cdEl = document.getElementById('banner-countdown');

  function tick() {
    var diff = expires.getTime() - Date.now();
    if (diff <= 0) {
      document.getElementById('solia-expired-overlay').classList.add('visible');
      cdEl.textContent = 'Expiré';
      return;
    }
    var d = Math.floor(diff/86400000), h = Math.floor((diff%86400000)/3600000);
    cdEl.textContent = d > 0 ? d+'j '+h+'h' : h+'h';
    setTimeout(tick, 60000);
  }
  tick();

  var current = document.documentElement.getAttribute('data-theme') || 'terracotta';
  var stored = localStorage.getItem('solia_theme_'+slug);
  if (stored) { current = stored; document.documentElement.setAttribute('data-theme', current); }
  document.querySelectorAll('.theme-dot-btn').forEach(function(dot){
    if (dot.dataset.t === current) dot.classList.add('active');
  });
  // theme applied — les click handlers sont ajoutés quand le DOM est prêt

  function initEditor() {
    var editableFields = document.querySelectorAll('[data-field]');
    var editMode = false;
    var hasChanges = false;

    var saveBar = document.createElement('div');
    saveBar.id = 'solia-save-bar';
    saveBar.innerHTML = '<span id="save-status">Modifications non sauvegardées</span><button id="save-btn">Valider les modifications</button>';
    saveBar.style.cssText = 'display:none;position:fixed;bottom:0;left:0;width:100%;z-index:99998;background:#1A1A18;color:#fff;padding:12px 24px;font-family:DM Sans,sans-serif;font-size:0.82rem;align-items:center;justify-content:center;gap:16px;box-shadow:0 -2px 16px rgba(0,0,0,0.15)';
    document.body.appendChild(saveBar);
    var saveBtnEl = document.getElementById('save-btn');
    saveBtnEl.style.cssText = 'background:#C4704F;color:#fff;border:none;padding:8px 20px;border-radius:100px;font-weight:700;font-size:0.78rem;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap';

    function showSaveBar() {
      showSaveBar();
    }

    // Theme click handlers (maintenant saveBar existe)
    document.querySelectorAll('.theme-dot-btn').forEach(function(dot){
      dot.addEventListener('click', function(){
        current = dot.dataset.t;
        document.documentElement.setAttribute('data-theme', current);
        document.querySelectorAll('.theme-dot-btn').forEach(function(x){ x.classList.remove('active'); });
        dot.classList.add('active');
        localStorage.setItem('solia_theme_'+slug, current);
        showSaveBar();
      });
    });

    // Toggle mode édition
    var editToggle = document.getElementById('edit-toggle');
    if (editToggle) {
      editToggle.addEventListener('click', function(){
        editMode = !editMode;
        editToggle.textContent = editMode ? 'Masquer' : 'Modifier';
        document.body.classList.toggle('edit-mode', editMode);
        editableFields.forEach(function(el){
          el.setAttribute('contenteditable', editMode ? 'true' : 'false');
          el.style.outline = editMode ? '2px dashed rgba(196,112,79,0.3)' : 'none';
          el.style.outlineOffset = '4px';
        });
        // Icônes sociales + photo overlay
        document.querySelectorAll('.hero-social-icon').forEach(function(icon){
          icon.style.cursor = editMode ? 'pointer' : '';
        });
        var po = document.getElementById('photo-overlay');
        if (po) po.style.display = editMode ? 'flex' : 'none';
        // Spécialités : cursor en mode édition
        if (specRow) specRow.style.cursor = editMode ? 'pointer' : '';
        // Pas de scroll auto — reste à la position actuelle
      });
    }

  editableFields.forEach(function(el){
    el.style.transition = 'outline 0.2s';
    el.style.borderRadius = '4px';
    el.addEventListener('focus', function(){ el.style.outline = '2px solid var(--c-accent)'; el.style.outlineOffset = '4px'; });
    el.addEventListener('blur', function(){ el.style.outline = editMode ? '2px dashed rgba(196,112,79,0.3)' : 'none'; });
    el.addEventListener('input', function(){
      if (!hasChanges) {
        hasChanges = true;
        saveBar.style.display = 'flex';
      }
    });
  });

  var funMessages = [
    'Sauvegarde en cours...',
    'Vos mots prennent forme...',
    'Un instant, la magie opère...',
    'Presque prêt...',
    'Votre page se met à jour...'
  ];

  document.getElementById('save-btn').addEventListener('click', function(){
    var btn = this;
    btn.disabled = true;
    var statusEl = document.getElementById('save-status');
    var msgIdx = 0;
    statusEl.textContent = funMessages[0];
    var msgTimer = setInterval(function(){
      msgIdx++;
      if (msgIdx < funMessages.length) statusEl.textContent = funMessages[msgIdx];
    }, 3000);

    var payload = { slug: slug, email: 'update@solia.me' };
    editableFields.forEach(function(el){
      var field = el.dataset.field;
      var text = el.innerText.trim();
      if (field === 'nom_complet') {
        var clean = text.replace(/\\s+/g, ' ').trim();
        var parts = clean.split(' ');
        payload.prenom = parts[0] || '';
        payload.nom = parts.slice(1).join(' ') || '';
      } else {
        payload[field] = text.replace(/\\n/g, ' ').trim();
      }
    });
    payload.theme = current;
    Object.keys(socialChanges).forEach(function(k){ payload[k] = socialChanges[k]; });
    // Spécialités
    if (specRow) {
      var specs = [];
      specRow.querySelectorAll('.specialite-tag').forEach(function(t){ specs.push(t.textContent.trim()); });
      payload.services = specs.join('\\n');
    }

    fetch('https://solia-enrichment.damien-reiss.workers.dev/api/personalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res){ return res.json(); })
    .then(function(){
      clearInterval(msgTimer);
      statusEl.textContent = 'Sauvegardé ! Votre page sera mise à jour dans ~2 minute.';
      btn.textContent = '✓';
      btn.style.background = '#2E7D32';
      setTimeout(function(){
        saveBar.style.display = 'none';
        hasChanges = false;
        btn.disabled = false;
        btn.textContent = 'Valider les modifications';
        btn.style.background = '';
      }, 5000);
    })
    .catch(function(err){
      clearInterval(msgTimer);
      statusEl.textContent = 'Erreur : ' + err.message;
      btn.disabled = false;
    });
  });

  // Style du bouton save
  var saveBtnEl = document.getElementById('save-btn');
  saveBtnEl.style.cssText = 'background:#C4704F;color:#fff;border:none;padding:8px 20px;border-radius:100px;font-weight:700;font-size:0.78rem;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap';

  // ── SOCIAL PANEL ──
  var socialPanel = document.getElementById('social-panel');
  document.getElementById('social-toggle').addEventListener('click', function(){
    socialPanel.classList.toggle('visible');
  });
  // Close on click outside
  document.addEventListener('click', function(e){
    if (socialPanel.classList.contains('visible') && !socialPanel.contains(e.target) && e.target.id !== 'social-toggle') {
      socialPanel.classList.remove('visible');
    }
  });

  document.getElementById('social-save').addEventListener('click', function(){
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';
    var payload = {
      slug: slug,
      email: 'update@solia.me',
      instagram_url: document.getElementById('soc-instagram').value.trim(),
      facebook_url: document.getElementById('soc-facebook').value.trim(),
      linkedin_url: document.getElementById('soc-linkedin').value.trim(),
      site_actuel: document.getElementById('soc-site').value.trim()
    };
    payload.theme = current;

    fetch('https://solia-enrichment.damien-reiss.workers.dev/api/personalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res){ return res.json(); })
    .then(function(){
      btn.textContent = 'Enregistré !';
      btn.style.background = '#2E7D32';
      // Mettre à jour les liens sociaux visibles sur la page
      var socialRow = document.getElementById('social-row');
      if (socialRow) {
        var links = '';
        var socials = [
          { id:'soc-instagram', label:'Instagram', icon:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/></svg>' },
          { id:'soc-facebook', label:'Facebook', icon:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>' },
          { id:'soc-linkedin', label:'LinkedIn', icon:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-4 0v7h-4v-7a6 6 0 016-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>' },
          { id:'soc-site', label:'Mon site', icon:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>' }
        ];
        socials.forEach(function(s){
          var val = document.getElementById(s.id).value.trim();
          if (val) links += '<a href="' + val + '" class="social-link" target="_blank" rel="noopener">' + s.icon + '<span>' + s.label + '</span></a>';
        });
        socialRow.innerHTML = links;
      }
      setTimeout(function(){
        btn.textContent = 'Enregistrer';
        btn.style.background = '';
        btn.disabled = false;
        socialPanel.classList.remove('visible');
      }, 2000);
    })
    .catch(function(err){
      btn.textContent = 'Erreur';
      btn.disabled = false;
      setTimeout(function(){ btn.textContent = 'Enregistrer'; btn.style.background = ''; }, 2000);
    });
  });
  // ── SPECIALITES (ajout dynamique en mode édition) ──
  var specRow = document.getElementById('specialites-row');
  if (specRow) {
    specRow.addEventListener('click', function(){
      if (!editMode) return;
      var input = prompt('Ajouter une spécialité :');
      if (!input || !input.trim()) return;
      var tag = document.createElement('span');
      tag.className = 'specialite-tag';
      tag.textContent = input.trim();
      tag.style.cursor = 'pointer';
      tag.title = 'Cliquer pour supprimer';
      tag.addEventListener('click', function(e){
        if (!editMode) return;
        e.stopPropagation();
        if (confirm('Supprimer "' + tag.textContent + '" ?')) tag.remove();
        showSaveBar();
      });
      specRow.appendChild(tag);
      showSaveBar();
    });
    // Rendre les tags existants supprimables en mode édition
    specRow.querySelectorAll('.specialite-tag').forEach(function(tag){
      tag.addEventListener('click', function(e){
        if (!editMode) return;
        e.stopPropagation();
        if (confirm('Supprimer "' + tag.textContent + '" ?')) tag.remove();
        showSaveBar();
      });
    });
  }

  // ── SOCIAL ICONS (inline edit — seulement en mode édition) ──
  var socialPrefixes = {
    instagram: 'https://instagram.com/',
    facebook: 'https://facebook.com/',
    linkedin: 'https://linkedin.com/in/',
    site: ''
  };
  var socialFields = {
    instagram: 'instagram_url',
    facebook: 'facebook_url',
    linkedin: 'linkedin_url',
    site: 'site_actuel'
  };
  var socialChanges = {};

  document.querySelectorAll('.hero-social-icon').forEach(function(icon){
    var social = icon.dataset.social;
    if (!social) return;

    icon.addEventListener('click', function(e){
      e.preventDefault();
      if (!editMode) return; // seulement en mode édition

      var prefix = socialPrefixes[social];
      var currentHref = icon.getAttribute('href') || '';
      var currentVal = currentHref.replace(prefix, '');

      var input = social === 'site'
        ? prompt('Votre site web (URL complète) :', currentHref || 'https://')
        : prompt('Votre pseudo ' + social.charAt(0).toUpperCase() + social.slice(1) + ' :', currentVal);

      if (input === null) return;

      var fullUrl = social === 'site' ? input.trim() : (prefix + input.trim());
      if (!input.trim()) fullUrl = '';

      icon.setAttribute('href', fullUrl);
      icon.style.opacity = fullUrl ? '1' : '0.25';
      socialChanges[socialFields[social]] = fullUrl;

      showSaveBar();
    });
  });

  // ── PHOTO UPLOAD (seulement en mode édition) ──
  var photoInput = document.createElement('input');
  photoInput.type = 'file';
  photoInput.id = 'photo-file-input';
  photoInput.accept = 'image/*';
  document.body.appendChild(photoInput);

  var heroVisual = document.getElementById('heroVisual');
  if (heroVisual) {
    // Overlay cliquable dédié (évite conflit avec parallax)
    var photoOverlay = document.createElement('div');
    photoOverlay.id = 'photo-overlay';
    photoOverlay.style.cssText = 'display:none;position:absolute;inset:0;z-index:10;cursor:pointer;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;color:#fff;font-family:DM Sans,sans-serif;font-size:0.85rem;font-weight:600';
    photoOverlay.textContent = 'Modifier la photo';
    heroVisual.style.position = 'relative';
    heroVisual.appendChild(photoOverlay);
    photoOverlay.addEventListener('click', function(e){ e.stopPropagation(); photoInput.click(); });
  }

  photoInput.addEventListener('change', function(){
    var file = photoInput.files[0];
    if (!file) return;

    // Aperçu instantané
    var reader = new FileReader();
    reader.onload = function(e){
      var dataUri = e.target.result;

      // Transformer en mode photo si c'était des initiales
      if (heroVisual.classList.contains('hero-visual--initials')) {
        heroVisual.classList.remove('hero-visual--initials');
        heroVisual.classList.add('hero-visual--photo');
        heroVisual.innerHTML = '<div class="hero-photo-circle"><img class="hero-photo-img" id="heroImg" src="' + dataUri + '" style="width:100%;height:100%;object-fit:cover" loading="eager"></div>';
      } else {
        var img = document.getElementById('heroImg');
        if (img) img.src = dataUri;
      }

      // Upload au Worker
      var statusEl = document.getElementById('save-status');
      saveBar.style.display = 'flex';
      statusEl.textContent = 'Upload de la photo...';

      fetch('https://solia-enrichment.damien-reiss.workers.dev/api/personalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: slug,
          email: 'update@solia.me',
          photo_profil: dataUri,
          theme: current
        })
      })
      .then(function(res){ return res.json(); })
      .then(function(){
        statusEl.textContent = 'Photo sauvegardée ! Mise à jour dans ~2 min.';
        setTimeout(function(){ saveBar.style.display = 'none'; }, 4000);
      })
      .catch(function(err){
        statusEl.textContent = 'Erreur : ' + err.message;
      });
    };
    reader.readAsDataURL(file);
  });

  } // fin initEditor

  // Lancer dès que le DOM est prêt (fonctionne même si DOMContentLoaded a déjà fired)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
  } else {
    initEditor();
  }
})();
</script>`;

  html = html.replace('</head>', `${bannerCss}\n</head>`);
  html = html.replace(/<body([^>]*)>/, `<body$1>\n${bannerHtml}`);
  return html;
}

/* ─── Génération ─── */

function generatePage(p, template) {
  const isPublished = p.published === true;
  const isDemo = p.page_active === true && !isPublished;

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
  if (isDemo) html = injectPreviewBanner(html, p.slug, p.demo_created_at);

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
