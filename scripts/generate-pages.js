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
    instagram_url:        escapeHtml(p.instagram_url || ''),
    facebook_url:         escapeHtml(p.facebook_url || ''),
    linkedin_url:         escapeHtml(p.linkedin_url || ''),
    site_actuel:          escapeHtml(p.site_actuel || ''),
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
  const stripeUrl = `https://buy.stripe.com/28E4gAd7XawU2xl0WA67S0a?client_reference_id=${slug}`;
  const created = demoCreatedAt || new Date().toISOString();
  const WORKER = 'https://solia-enrichment.damien-reiss.workers.dev';

  const bannerCss = `
<style id="solia-preview-banner-style">
  #solia-preview-banner{position:fixed;top:0;left:0;width:100%;z-index:99999;background:#1A1A18;color:#fff;display:flex;align-items:center;justify-content:center;gap:10px;padding:9px 16px;font-family:'DM Sans',sans-serif;font-size:.75rem;font-weight:500;box-shadow:0 2px 16px rgba(0,0,0,.18)}
  .banner-btn{font-weight:700;font-size:.7rem;padding:5px 13px;border-radius:100px;text-decoration:none;white-space:nowrap;transition:opacity .2s;flex-shrink:0;border:none;cursor:pointer;font-family:'DM Sans',sans-serif}
  .banner-btn-secondary{background:rgba(255,255,255,.15);color:#fff}
  .banner-btn-primary{background:#C4704F;color:#fff}
  .banner-btn:hover{opacity:.85}
  .banner-countdown{color:rgba(255,255,255,.6);white-space:nowrap;font-size:.68rem;flex-shrink:0}
  .theme-dots{display:flex;gap:4px;align-items:center;flex-shrink:0}
  .theme-dot-btn{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.2);cursor:pointer;transition:border-color .2s,transform .15s;flex-shrink:0}
  .theme-dot-btn:hover{transform:scale(1.15)}
  .theme-dot-btn.active{border-color:#fff;transform:scale(1.15)}
  body{padding-top:40px!important}
  @media(max-width:640px){#solia-preview-banner{gap:6px;padding:7px 10px}.banner-btn{font-size:.65rem;padding:5px 10px}.theme-dot-btn{width:18px;height:18px}body{padding-top:38px!important}}
  #solia-expired-overlay{display:none;position:fixed;inset:0;z-index:999999;background:rgba(253,250,246,.96);backdrop-filter:blur(8px);flex-direction:column;align-items:center;justify-content:center;gap:20px;text-align:center;padding:32px;font-family:'DM Sans',sans-serif}
  #solia-expired-overlay.visible{display:flex}
  .expired-title{font-family:'Playfair Display',serif;font-size:1.5rem;font-weight:600;color:#1A1A18}
  .expired-sub{font-size:.9rem;color:#8A8074;max-width:380px;line-height:1.6}
  .expired-btn{background:#C4704F;color:#fff;font-weight:700;font-size:.9rem;padding:14px 32px;border-radius:100px;text-decoration:none}
  .expired-btn:hover{background:#A85C3E}
  .expired-link{font-size:.82rem;color:#8A8074}
  #solia-save-bar{display:none;position:fixed;bottom:0;left:0;width:100%;z-index:99998;background:#1A1A18;color:#fff;padding:12px 24px;font-family:'DM Sans',sans-serif;font-size:.82rem;align-items:center;justify-content:center;gap:16px;box-shadow:0 -2px 16px rgba(0,0,0,.15)}
  #solia-save-bar button{background:#C4704F;color:#fff;border:none;padding:8px 20px;border-radius:100px;font-weight:700;font-size:.78rem;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap}
  .edit-outline{outline:2px dashed rgba(196,112,79,.3)!important;outline-offset:4px;border-radius:4px}
  .edit-focus{outline:2px solid var(--c-accent)!important;outline-offset:4px}
  .photo-edit-overlay{display:none;position:absolute;inset:0;z-index:10;cursor:pointer;background:rgba(0,0,0,.5);align-items:center;justify-content:center;color:#fff;font-family:'DM Sans',sans-serif;font-size:.85rem;font-weight:600}
  .spec-add-btn{display:none;cursor:pointer;font-size:.75rem;padding:5px 14px;border-radius:100px;border:1.5px dashed var(--c-border);color:var(--c-muted);background:none;font-family:'DM Sans',sans-serif}
  .spec-add-btn:hover{border-color:var(--c-accent);color:var(--c-accent)}
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
<div id="solia-save-bar"><span id="save-status">Modifications non sauvegardées</span><button id="save-btn">Valider les modifications</button></div>
<div id="solia-expired-overlay">
  <div class="expired-title">Votre essai a expiré</div>
  <div class="expired-sub">Votre page de démonstration n'est plus disponible. Publiez-la pour la garder en ligne.</div>
  <a href="${stripeUrl}" class="expired-btn">Publier ma page &rarr;</a>
  <a href="mailto:damien.reiss@gmail.com?subject=Page%20Solia%20%E2%80%94%20${slug}" class="expired-link">Nous contacter</a>
</div>
<input type="file" id="photo-file-input" accept="image/*" style="display:none">
<script>
(function(){
  var SLUG='${slug}',W='${WORKER}',ST='${stripeUrl}';
  var created=new Date('${created}'),expires=new Date(created.getTime()+7*864e5);
  var cdEl=document.getElementById('banner-countdown');
  var editMode=false,hasChanges=false,current,photoDataUri='';
  var saveBar=document.getElementById('solia-save-bar');

  function tick(){var d=expires.getTime()-Date.now();if(d<=0){document.getElementById('solia-expired-overlay').classList.add('visible');cdEl.textContent='Expir\\u00e9';return}var j=Math.floor(d/864e5),h=Math.floor(d%864e5/36e5),m=Math.floor(d%36e5/6e4);cdEl.textContent=j>0?j+'j '+h+'h':h+'h '+m+'min';setTimeout(tick,6e4)}
  tick();

  current=document.documentElement.getAttribute('data-theme')||'terracotta';
  var st=localStorage.getItem('solia_theme_'+SLUG);
  if(st){current=st;document.documentElement.setAttribute('data-theme',current)}
  document.querySelectorAll('.theme-dot-btn').forEach(function(d){
    if(d.dataset.t===current)d.classList.add('active');
    d.addEventListener('click',function(){current=d.dataset.t;document.documentElement.setAttribute('data-theme',current);document.querySelectorAll('.theme-dot-btn').forEach(function(x){x.classList.remove('active')});d.classList.add('active');localStorage.setItem('solia_theme_'+SLUG,current);markChanged()})
  });

  function markChanged(){if(!hasChanges){hasChanges=true;saveBar.style.display='flex'}}

  function init(){
    var fields=document.querySelectorAll('[data-field]');
    var specRow=document.getElementById('specialites-row');
    var heroVisual=document.getElementById('heroVisual');
    var photoInput=document.getElementById('photo-file-input');
    var socIcons=document.querySelectorAll('.hero-soc');
    var editBtn=document.getElementById('edit-toggle');

    // Hide empty social icons by default
    socIcons.forEach(function(ic){if(!ic.getAttribute('href'))ic.style.display='none'});

    // EDIT TOGGLE
    editBtn.addEventListener('click',function(){
      editMode=!editMode;
      editBtn.textContent=editMode?'Masquer':'Modifier';
      document.body.classList.toggle('edit-mode',editMode);
      fields.forEach(function(el){
        el.setAttribute('contenteditable',editMode?'true':'false');
        if(editMode)el.classList.add('edit-outline');else el.classList.remove('edit-outline');
      });
      var po=document.getElementById('photo-edit-overlay');
      if(po)po.style.display=editMode?'flex':'none';
      socIcons.forEach(function(ic){if(editMode){ic.style.display='flex';ic.style.opacity=ic.getAttribute('href')?'1':'0.35';ic.style.cursor='pointer'}else{ic.style.display=ic.getAttribute('href')?'flex':'none';ic.style.cursor='';ic.style.opacity='1'}});
      var ab=document.getElementById('spec-add-btn');if(ab)ab.style.display=editMode?'inline-block':'none';
    });

    // FIELD EVENTS
    fields.forEach(function(el){
      el.addEventListener('focus',function(){el.classList.remove('edit-outline');el.classList.add('edit-focus')});
      el.addEventListener('blur',function(){el.classList.remove('edit-focus');if(editMode)el.classList.add('edit-outline')});
      el.addEventListener('input',markChanged);
    });

    // PHOTO
    if(heroVisual){
      heroVisual.style.position='relative';
      var po=document.createElement('div');po.id='photo-edit-overlay';po.className='photo-edit-overlay';po.textContent='Modifier la photo';heroVisual.appendChild(po);
      po.addEventListener('click',function(e){e.stopPropagation();photoInput.click()});
    }
    photoInput.addEventListener('change',function(){
      var f=photoInput.files[0];if(!f)return;
      var r=new FileReader();
      r.onload=function(e){
        photoDataUri=e.target.result;
        if(heroVisual.classList.contains('hero-visual--initials')){heroVisual.classList.remove('hero-visual--initials');heroVisual.classList.add('hero-visual--photo');heroVisual.innerHTML='<div class="hero-photo-circle"><img class="hero-photo-img" id="heroImg" src="'+photoDataUri+'" style="width:100%;height:100%;object-fit:cover"></div>';var po2=document.createElement('div');po2.id='photo-edit-overlay';po2.className='photo-edit-overlay';po2.textContent='Modifier la photo';po2.style.display='flex';heroVisual.appendChild(po2);po2.addEventListener('click',function(ev){ev.stopPropagation();photoInput.click()})}
        else{var img=document.getElementById('heroImg');if(img)img.src=photoDataUri}
        markChanged();
      };r.readAsDataURL(f);
    });

    // SOCIAL ICONS
    socIcons.forEach(function(ic){
      ic.addEventListener('click',function(e){
        e.preventDefault();if(!editMode)return;
        var soc=ic.dataset.soc,pfx=ic.dataset.prefix||'',cur=(ic.getAttribute('href')||'').replace(pfx,'');
        var val=soc==='site'?prompt('URL de votre site web :',ic.getAttribute('href')||'https://'):prompt('Votre pseudo '+soc.charAt(0).toUpperCase()+soc.slice(1)+' :',cur);
        if(val===null)return;
        var url=soc==='site'?val.trim():(val.trim()?pfx+val.trim():'');
        ic.setAttribute('href',url);ic.style.opacity=url?'1':'0.35';markChanged();
      });
    });

    // SPECIALITES
    if(specRow){
      var ab=document.createElement('button');ab.id='spec-add-btn';ab.className='spec-add-btn';ab.textContent='+ Ajouter';ab.style.display='none';specRow.appendChild(ab);
      ab.addEventListener('click',function(){var v=prompt('Nouvelle sp\\u00e9cialit\\u00e9 :');if(!v||!v.trim())return;var t=document.createElement('span');t.className='specialite-tag';t.textContent=v.trim();specRow.insertBefore(t,ab);markChanged();t.addEventListener('click',function(){if(!editMode)return;if(confirm('Supprimer "'+t.textContent+'" ?')){t.remove();markChanged()}})});
      specRow.querySelectorAll('.specialite-tag').forEach(function(t){t.addEventListener('click',function(){if(!editMode)return;if(confirm('Supprimer "'+t.textContent+'" ?')){t.remove();markChanged()}})});
    }

    // SAVE
    document.getElementById('save-btn').addEventListener('click',function(){
      var btn=this;btn.disabled=true;
      var sts=document.getElementById('save-status');
      var msgs=['Sauvegarde en cours...','Vos mots prennent forme...','Un instant, la magie op\\u00e8re...','Presque pr\\u00eat...'];
      var mi=0;sts.textContent=msgs[0];var timer=setInterval(function(){mi++;if(mi<msgs.length)sts.textContent=msgs[mi]},3e3);

      var payload={slug:SLUG,email:'update@solia.me',theme:current};
      fields.forEach(function(el){var f=el.dataset.field,txt=el.innerText.replace(/[\\r\\n]+/g,' ').replace(/  +/g,' ').trim();if(f==='nom_complet'){var p=txt.split(' ');payload.prenom=p[0]||'';payload.nom=p.slice(1).join(' ')||''}else{payload[f]=txt}});
      if(specRow){var sp=[];specRow.querySelectorAll('.specialite-tag').forEach(function(t){sp.push(t.textContent.trim())});payload.services=sp.join('\\n')}
      socIcons.forEach(function(ic){var m={instagram:'instagram_url',facebook:'facebook_url',linkedin:'linkedin_url',site:'site_actuel'};var k=m[ic.dataset.soc];if(k)payload[k]=ic.getAttribute('href')||''});
      if(photoDataUri)payload.photo_profil=photoDataUri;

      fetch(W+'/api/personalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json()})
      .then(function(){clearInterval(timer);sts.textContent='Sauvegard\\u00e9 ! Mise \\u00e0 jour dans environ 2 minutes.';btn.textContent='\\u2713';btn.style.background='#2E7D32';photoDataUri='';setTimeout(function(){saveBar.style.display='none';hasChanges=false;btn.disabled=false;btn.textContent='Valider les modifications';btn.style.background=''},5e3)})
      .catch(function(err){clearInterval(timer);sts.textContent='Erreur : '+err.message;btn.disabled=false});
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>`;

  html = html.replace('</head>', bannerCss + '\n</head>');
  html = html.replace(/<body([^>]*)>/, '<body$1>\n' + bannerHtml);
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

  // Préserver la date de création du compteur lors d'un rebuild --force
  if (isDemo && !p.demo_created_at && fs.existsSync(outFile)) {
    const existing = fs.readFileSync(outFile, 'utf8');
    const match = existing.match(/var created=new Date\('([^']+)'\)/);
    if (match) p.demo_created_at = match[1];
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
