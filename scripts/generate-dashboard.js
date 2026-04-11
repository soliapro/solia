/**
 * generate-dashboard.js
 * Régénère demos/dashboard/index.html avec TOUS les prospects.
 * Appelé automatiquement par le workflow GitHub Actions.
 */

const fs   = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const DEMOS_DIR     = path.join(ROOT, 'demos');
const PROSPECTS_DIR = path.join(ROOT, 'prospects');
const DASHBOARD_DIR = path.join(DEMOS_DIR, 'dashboard');
const OUT_FILE      = path.join(DASHBOARD_DIR, 'index.html');

const IGNORE = new Set(['dashboard', 'formulaire']);

/* ─── Nettoyage des noms (données scraping) ─── */

function cleanNom(nom, metier) {
  if (!nom) return '';
  let clean = nom;
  // Retirer le métier s'il apparaît dans le nom
  if (metier) {
    const re = new RegExp('\\s*' + escapeRegex(metier) + '\\s*', 'gi');
    clean = clean.replace(re, ' ').trim();
  }
  // Retirer suffixes courants (Thérapie, Coaching, etc.)
  clean = clean.replace(/\s+(Th[ée]rapie|Coaching|Hypnose|Magnétiseur|Réflexologie)\s*$/i, '').trim();
  // Title-case si tout en majuscules (mais garder les noms composés comme EL JOUHARI)
  if (/^[A-ZÀ-Ü\s'-]+$/.test(clean) && clean.length > 1) {
    clean = clean.toLowerCase().replace(/(^|\s|-|')(\S)/g, (_, sep, c) => sep + c.toUpperCase());
  }
  return clean;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ─── Chargement des prospects ─── */

function loadAllProspects() {
  const prospects = [];
  if (!fs.existsSync(PROSPECTS_DIR)) return prospects;

  const files = fs.readdirSync(PROSPECTS_DIR).filter(f => f.endsWith('.json'));

  for (const f of files) {
    try {
      const raw  = fs.readFileSync(path.join(PROSPECTS_DIR, f), 'utf8');
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];

      for (const p of items) {
        if (!p.slug) continue;

        const hasPage = fs.existsSync(path.join(DEMOS_DIR, p.slug, 'index.html'));

        // Calculer le temps restant d'essai
        let trial_days_left = null;
        if (p.demo_created_at && !p.published) {
          const created = new Date(p.demo_created_at).getTime();
          const remaining = 7 - Math.floor((Date.now() - created) / 86400000);
          trial_days_left = Math.max(0, remaining);
        }

        prospects.push({
          slug:           p.slug,
          prenom:         p.prenom         || '',
          nom:            cleanNom(p.nom || '', p.metier || ''),
          metier:         p.metier         || '',
          ville:          p.ville          || '',
          departement:    p.departement    || '',
          telephone:      p.telephone      || '',
          email:          p.email          || '',
          photo_url:      p.photo_url      || '',
          avis_note:      p.avis_google_note ?? null,
          avis_nb:        p.avis_google_nb   ?? null,
          horaires:       p.horaires       || '',
          adresse:        p.adresse        || '',
          has_page:       hasPage,
          priorite:       p.priorite || p.priorite_solia || '',
          source:         p.source         || '',
          paid:           p.paid === true,
          published:      p.published === true,
          prospected_at:  p.prospected_at  || '',
          demo_created_at: p.demo_created_at || '',
          trial_days_left,
          cancelled_at:   p.cancelled_at   || '',
        });
      }
    } catch (err) {
      console.warn(`  Erreur lecture ${f}: ${err.message}`);
    }
  }

  return prospects;
}

/* ─── Génération ─── */

function generate() {
  if (!fs.existsSync(DASHBOARD_DIR)) fs.mkdirSync(DASHBOARD_DIR, { recursive: true });

  const prospects = loadAllProspects();

  const total     = prospects.length;
  const withPage  = prospects.filter(p => p.has_page).length;
  const withPhone = prospects.filter(p => p.telephone).length;
  const paidCount = prospects.filter(p => p.paid).length;
  const organicCount = prospects.filter(p => p.source === 'organic').length;

  const prospectsJson = JSON.stringify(prospects);
  const html = buildHtml(prospectsJson, total, withPage, withPhone, paidCount, organicCount);

  fs.writeFileSync(OUT_FILE, html, 'utf8');
  console.log(`Dashboard généré — ${total} prospect(s), ${withPage} page(s) en ligne.`);
}

/* ─── HTML ─── */

function buildHtml(prospectsJson, total, withPage, withPhone, paidCount, organicCount) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Solia — Prospection</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #F4EFE8; --bg-card: #FDFAF6; --dark: #1A1A18; --accent: #C4704F;
      --accent-d: #A85C3E; --muted: #8A8074; --border: #E4DDD4;
      --green: #2E7D32; --green-bg: rgba(46,125,50,0.08);
      --ff-serif: 'Playfair Display', Georgia, serif;
      --ff-sans: 'DM Sans', 'Helvetica Neue', sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--ff-sans); background: var(--bg); color: var(--dark); min-height: 100vh; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }

    /* NAV */
    .nav { background: var(--dark); padding: 0 32px; height: 56px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
    .nav-logo { font-family: var(--ff-serif); font-style: italic; font-size: 1.3rem; font-weight: 600; color: var(--bg-card); }
    .nav-badge { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(253,250,246,0.4); }

    /* MAIN */
    .main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; }
    .header { margin-bottom: 28px; }
    .header h1 { font-family: var(--ff-serif); font-size: 1.8rem; font-weight: 600; margin-bottom: 4px; }
    .header p { font-size: 0.88rem; color: var(--muted); }

    /* STATS */
    .stats-bar { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat-pill { background: var(--dark); color: var(--bg-card); font-size: 0.78rem; font-weight: 500; padding: 7px 16px; border-radius: 100px; display: flex; align-items: center; gap: 7px; }
    .stat-pill strong { color: var(--accent); font-size: 0.95rem; font-weight: 700; }

    /* CSV IMPORT */
    .csv-zone { border: 2px dashed var(--border); border-radius: 14px; padding: 28px; text-align: center; margin-bottom: 24px; cursor: pointer; transition: border-color 0.2s, background 0.2s; position: relative; }
    .csv-zone:hover, .csv-zone.drag-over { border-color: var(--accent); background: rgba(196,112,79,0.04); }
    .csv-zone input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .csv-zone-label { font-size: 0.88rem; color: var(--muted); }
    .csv-zone-label strong { color: var(--accent); }
    .csv-zone-sub { font-size: 0.75rem; color: var(--border); margin-top: 4px; }
    .csv-result { display: none; background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 14px; padding: 20px; margin-bottom: 24px; font-size: 0.85rem; }
    .csv-result.visible { display: block; }
    .csv-result .csv-stats { margin-bottom: 12px; }
    .csv-result .csv-stats strong { color: var(--accent); }
    .csv-actions { display: flex; gap: 10px; }
    .btn-import { background: var(--accent); color: #fff; font-family: var(--ff-sans); font-size: 0.85rem; font-weight: 600; padding: 10px 24px; border-radius: 100px; border: none; cursor: pointer; transition: background 0.2s; }
    .btn-import:hover { background: var(--accent-d); }
    .btn-import:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-cancel { background: none; border: 1.5px solid var(--border); color: var(--muted); font-family: var(--ff-sans); font-size: 0.85rem; font-weight: 500; padding: 10px 24px; border-radius: 100px; cursor: pointer; }

    /* FILTERS */
    .filters { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
    .filter-btn { background: var(--bg-card); border: 1.5px solid var(--border); color: var(--muted); font-family: var(--ff-sans); font-size: 0.78rem; font-weight: 500; padding: 7px 16px; border-radius: 100px; cursor: pointer; transition: all 0.2s; }
    .filter-btn:hover { border-color: var(--accent); color: var(--accent); }
    .filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .search-input { flex: 1; min-width: 200px; background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 100px; padding: 8px 18px; font-family: var(--ff-sans); font-size: 0.85rem; color: var(--dark); outline: none; }
    .search-input:focus { border-color: var(--accent); }
    .search-input::placeholder { color: var(--border); }

    /* TABLE */
    .prospect-table { width: 100%; border-collapse: separate; border-spacing: 0 6px; }
    .prospect-table th { text-align: left; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 8px 12px; }
    .prospect-table td { background: var(--bg-card); padding: 14px 12px; font-size: 0.85rem; border-top: 1px solid transparent; border-bottom: 1px solid transparent; }
    .prospect-table tr td:first-child { border-radius: 12px 0 0 12px; border-left: 1px solid transparent; }
    .prospect-table tr td:last-child { border-radius: 0 12px 12px 0; border-right: 1px solid transparent; }
    .prospect-table tbody tr { transition: transform 0.15s; }
    .prospect-table tbody tr:hover { transform: translateY(-1px); }
    .prospect-table tbody tr:hover td { border-color: var(--border); }

    .cell-name { font-weight: 600; }
    .cell-meta { font-size: 0.75rem; color: var(--muted); }
    .cell-phone { font-family: monospace; font-size: 0.82rem; white-space: nowrap; }
    .cell-phone a { color: var(--accent); }
    .cell-avis { font-size: 0.8rem; white-space: nowrap; }
    .cell-avis .star { color: #F5A623; }

    .badge { display: inline-block; font-size: 0.68rem; font-weight: 600; padding: 3px 10px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge-page { background: var(--green-bg); color: var(--green); }
    .badge-no-page { background: rgba(0,0,0,0.04); color: var(--muted); }
    .badge-contacted { background: rgba(196,112,79,0.1); color: var(--accent); }
    .badge-paid { background: rgba(212,175,55,0.12); color: #9A7B10; }
    .badge-organic { background: rgba(46,125,50,0.12); color: #2E7D32; }
    .badge-prospected { background: rgba(30,100,200,0.10); color: #1E64C8; }
    .badge-trial { background: rgba(255,152,0,0.12); color: #E65100; }
    .badge-expired { background: rgba(200,50,50,0.10); color: #c33; }
    .badge-cancelled { background: rgba(200,50,50,0.10); color: #c33; }

    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .btn-sm { font-family: var(--ff-sans); font-size: 0.72rem; font-weight: 600; padding: 6px 12px; border-radius: 100px; cursor: pointer; border: 1.5px solid var(--border); background: var(--bg-card); color: var(--dark); transition: all 0.2s; white-space: nowrap; }
    .btn-sm:hover { border-color: var(--accent); color: var(--accent); }
    .btn-sm.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-sm.btn-primary:hover { background: var(--accent-d); }
    .btn-sm.btn-done { background: var(--green-bg); color: var(--green); border-color: rgba(46,125,50,0.2); }
    .btn-sm.btn-danger { border-color: rgba(200,50,50,0.2); color: #c33; }
    .btn-sm.btn-danger:hover { border-color: #c33; background: rgba(200,50,50,0.06); }
    .btn-sm:disabled { opacity: 0.5; cursor: wait; }
    .page-link { font-size: 0.72rem; color: var(--accent); text-decoration: underline; white-space: nowrap; }

    .empty-row td { text-align: center; padding: 48px; color: var(--muted); font-size: 0.9rem; }

    @media (max-width: 768px) {
      .hide-mobile { display: none; }
      .main { padding: 16px 10px 60px; }
      .header h1 { font-size: 1.4rem; }
      .stats-bar { gap: 8px; }
      .stat-pill { font-size: 0.7rem; padding: 5px 12px; }
      .filters { gap: 6px; }
      .filter-btn { font-size: 0.7rem; padding: 5px 12px; }
      .search-input { min-width: 0; font-size: 0.8rem; padding: 7px 14px; }
      .csv-zone { padding: 16px; }

      /* Table → cards sur mobile */
      .prospect-table { border-spacing: 0 8px; }
      .prospect-table thead { display: none; }
      .prospect-table tbody tr { display: flex; flex-wrap: wrap; gap: 6px; padding: 14px; background: var(--bg-card); border-radius: 12px; margin-bottom: 8px; align-items: center; }
      .prospect-table tbody tr td { background: none; padding: 0; border: none; border-radius: 0; }
      .prospect-table tbody tr td:first-child { width: 100%; border: none; }
      .prospect-table tbody tr td:last-child { width: 100%; border: none; margin-top: 4px; }
      .actions { flex-wrap: wrap; }
      .cell-phone { font-size: 0.78rem; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <span class="nav-logo">Solia</span>
    <span class="nav-badge">Prospection</span>
  </nav>

  <main class="main">
    <div class="header">
      <h1>Prospection</h1>
      <p id="header-sub">${total} prospects &middot; ${withPhone} avec t&eacute;l&eacute;phone &middot; ${withPage} page(s) en ligne</p>
    </div>

    <!-- CSV IMPORT -->
    <div class="csv-zone" id="csv-zone">
      <input type="file" id="csv-file" accept=".csv">
      <div class="csv-zone-label"><strong>Glisser un CSV</strong> ici pour importer de nouveaux prospects</div>
      <div class="csv-zone-sub">Format attendu : colonnes slug, prenom, nom, metier, ville, telephone, etc.</div>
    </div>
    <div class="csv-result" id="csv-result">
      <div class="csv-stats" id="csv-stats"></div>
      <div class="csv-actions">
        <button class="btn-import" id="btn-csv-confirm">Importer</button>
        <button class="btn-cancel" id="btn-csv-cancel">Annuler</button>
      </div>
    </div>

    <div class="stats-bar">
      <div class="stat-pill"><strong id="stat-total">${total}</strong> prospects</div>
      <div class="stat-pill"><strong id="stat-pages">${withPage}</strong> en ligne</div>
      <div class="stat-pill"><strong id="stat-paid">${paidCount}</strong> pay&eacute;s</div>
      <div class="stat-pill"><strong id="stat-organic">${organicCount}</strong> organiques</div>
      <div class="stat-pill"><strong id="stat-contacted">0</strong> contact&eacute;s</div>
    </div>

    <div class="filters">
      <input type="text" class="search-input" id="search" placeholder="Rechercher un nom, m&eacute;tier, ville...">
      <button class="filter-btn active" data-filter="all">Tous</button>
      <button class="filter-btn" data-filter="has-page">En ligne</button>
      <button class="filter-btn" data-filter="paid">Pay&eacute;s</button>
      <button class="filter-btn" data-filter="not-paid">Non pay&eacute;s</button>
      <button class="filter-btn" data-filter="organic">Organiques</button>
      <button class="filter-btn" data-filter="prospected">Prospect&eacute;s</button>
      <button class="filter-btn" data-filter="contacted">Contact&eacute;s</button>
      <button class="filter-btn" data-filter="not-contacted">Pas contact&eacute;s</button>
      <button class="filter-btn" data-filter="trial-active">Essai actif</button>
      <button class="filter-btn" data-filter="trial-expired">Essai expir&eacute;</button>
      <button class="filter-btn" data-filter="haute">Haute priorit&eacute;</button>
    </div>

    <table class="prospect-table">
      <thead>
        <tr>
          <th>Prospect</th>
          <th>T&eacute;l&eacute;phone</th>
          <th class="hide-mobile">Avis Google</th>
          <th class="hide-mobile">Statut</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="prospect-list"></tbody>
    </table>
  </main>

  <script>
    'use strict';

    const WORKER_URL  = 'https://solia-enrichment.damien-reiss.workers.dev';
    const STORAGE_KEY = 'solia_prospection';
    const ADMIN_KEY_STORAGE = 'solia_admin_key';

    /* ---- ADMIN AUTH ---- */
    function getAdminKey() {
      let key = sessionStorage.getItem(ADMIN_KEY_STORAGE);
      if (!key) {
        key = prompt('Cl\\xe9 admin Solia :');
        if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
      }
      return key || '';
    }
    function adminHeaders() {
      return { 'Content-Type': 'application/json', 'X-Admin-Key': getAdminKey() };
    }

    /* ---- DATA ---- */
    let PROSPECTS = ${prospectsJson};

    /* ---- LOCALSTORAGE ---- */
    function loadTracking() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
    }
    function saveTracking(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    let tracking = loadTracking();

    /* ---- NAME CLEANING (client-side for CSV imports) ---- */
    function cleanName(nom, metier) {
      if (!nom) return '';
      let c = nom;
      if (metier) {
        c = c.replace(new RegExp('\\\\s*' + metier.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&') + '\\\\s*', 'gi'), ' ').trim();
      }
      c = c.replace(/\\s+(Th[ée]rapie|Coaching|Hypnose|Magnétiseur|Réflexologie)\\s*$/i, '').trim();
      if (/^[A-ZÀ-Ü\\s'\\-]+$/.test(c) && c.length > 1) {
        c = c.toLowerCase().replace(/(^|\\s|-|')(\\S)/g, (_, s, l) => s + l.toUpperCase());
      }
      return c;
    }

    /* ---- RENDER ---- */
    const tbody = document.getElementById('prospect-list');
    let currentFilter = 'all';
    let searchQuery   = '';

    function render() {
      const filtered = PROSPECTS.filter(p => {
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const hay = (p.prenom + ' ' + p.nom + ' ' + p.metier + ' ' + p.ville + ' ' + p.departement + ' ' + p.email).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        const t = tracking[p.slug];
        if (currentFilter === 'contacted' && !t) return false;
        if (currentFilter === 'not-contacted' && t) return false;
        if (currentFilter === 'has-page' && !p.has_page) return false;
        if (currentFilter === 'paid' && !p.paid) return false;
        if (currentFilter === 'not-paid' && p.paid) return false;
        if (currentFilter === 'organic' && p.source !== 'organic') return false;
        if (currentFilter === 'prospected' && p.source === 'organic') return false;
        if (currentFilter === 'haute' && p.priorite !== 'HAUTE') return false;
        if (currentFilter === 'trial-active' && (p.paid || !p.has_page || p.trial_days_left === null || p.trial_days_left <= 0)) return false;
        if (currentFilter === 'trial-expired' && (p.paid || p.trial_days_left === null || p.trial_days_left > 0)) return false;
        return true;
      });

      document.getElementById('stat-total').textContent = PROSPECTS.length;
      document.getElementById('stat-pages').textContent = PROSPECTS.filter(pr => pr.has_page).length;
      document.getElementById('stat-paid').textContent = PROSPECTS.filter(pr => pr.paid).length;
      document.getElementById('stat-organic').textContent = PROSPECTS.filter(pr => pr.source === 'organic').length;
      document.getElementById('stat-contacted').textContent = Object.keys(tracking).length;

      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:48px;color:var(--muted)">Aucun prospect trouv&eacute;</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map(p => {
        const name    = (p.prenom + ' ' + p.nom).trim() || p.slug;
        const t       = tracking[p.slug];
        const dateStr = t ? new Date(t).toLocaleDateString('fr-FR') : '';
        const phoneRaw = p.telephone ? p.telephone.replace(/\\s/g, '') : '';

        // Badges de source
        let sourceBadge = '';
        if (p.source === 'organic') sourceBadge = '<span class="badge badge-organic">organique</span> ';
        else if (p.source === 'prospected') sourceBadge = '<span class="badge badge-prospected">prospect&eacute;</span> ';

        // Badge paiement
        let payBadge = '';
        if (p.paid) payBadge = '<span class="badge badge-paid">&check; pay&eacute;</span> ';
        else if (p.cancelled_at) payBadge = '<span class="badge badge-cancelled">r&eacute;sili&eacute;</span> ';

        // Badge essai
        let trialBadge = '';
        if (!p.paid && p.trial_days_left !== null) {
          if (p.trial_days_left > 0) trialBadge = '<span class="badge badge-trial">J-' + p.trial_days_left + '</span> ';
          else trialBadge = '<span class="badge badge-expired">expir&eacute;</span> ';
        }

        // Date de prospection
        const prospDate = p.prospected_at ? new Date(p.prospected_at).toLocaleDateString('fr-FR') : '';

        return '<tr>' +
          '<td>' +
            '<div class="cell-name">' + esc(name) + '</div>' +
            '<div class="cell-meta">' + esc(p.metier) + ' &middot; ' + esc(p.ville) + (p.departement ? ' (' + esc(p.departement) + ')' : '') +
              (p.priorite === 'HAUTE' ? ' <span class="badge" style="background:rgba(196,112,79,0.12);color:var(--accent)">haute</span>' : '') +
            '</div>' +
          '</td>' +
          '<td class="cell-phone">' +
            (p.telephone ? '<a href="tel:' + esc(phoneRaw) + '">' + esc(p.telephone) + '</a>' : '<span style="color:var(--border)">&mdash;</span>') +
          '</td>' +
          '<td class="hide-mobile cell-avis">' +
            (p.avis_note ? '<span class="star">&#9733;</span> ' + p.avis_note + '/5 <span style="color:var(--muted)">(' + p.avis_nb + ')</span>' : '<span style="color:var(--border)">&mdash;</span>') +
          '</td>' +
          '<td class="hide-mobile">' +
            sourceBadge +
            (p.has_page
              ? '<span class="badge badge-page">En ligne</span> '
              : '<span class="badge badge-no-page">Hors ligne</span> '
            ) +
            payBadge +
            trialBadge +
            (t ? '<span class="badge badge-contacted">' + dateStr + '</span> ' : '') +
            (p.has_page ? '<a href="https://' + p.slug + '.solia.me" target="_blank" class="page-link">' + p.slug + '.solia.me</a>' : '') +
          '</td>' +
          '<td class="actions">' +
            (p.has_page
              ? '<a href="https://' + p.slug + '.solia.me" target="_blank" class="btn-sm">Voir</a>' +
                '<a href="https://solia.me/formulaire/?prospect=' + p.slug + '" target="_blank" class="btn-sm btn-primary">Personnaliser</a>' +
                '<button class="btn-sm btn-danger" onclick="togglePage(\\'' + p.slug + '\\', false)">Hors ligne</button>'
              : '<button class="btn-sm btn-primary" onclick="togglePage(\\'' + p.slug + '\\', true)">En ligne</button>'
            ) +
            (t
              ? '<button class="btn-sm btn-done" onclick="unmark(\\'' + p.slug + '\\')">&check; ' + dateStr + '</button>'
              : '<button class="btn-sm" onclick="mark(\\'' + p.slug + '\\')">Contact&eacute;</button>'
            ) +
          '</td>' +
        '</tr>';
      }).join('');
    }

    function esc(s) {
      if (!s) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ---- TOGGLE PAGE ---- */
    window.togglePage = async function(slug, activate) {
      const action = activate ? 'Mettre en ligne' : 'Retirer';
      if (!confirm(action + ' la page de ' + slug + ' ?')) return;

      // Disable le bouton pendant l'appel
      event.target.disabled = true;
      event.target.textContent = activate ? 'Cr\u00e9ation...' : 'Suppression...';

      try {
        const res = await fetch(WORKER_URL + '/api/toggle-page', {
          method: 'POST',
          headers: adminHeaders(),
          body: JSON.stringify({ slug, active: activate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur serveur');

        // Mettre à jour l'état local
        const p = PROSPECTS.find(pr => pr.slug === slug);
        if (p) p.has_page = activate;
        document.getElementById('stat-pages').textContent = PROSPECTS.filter(pr => pr.has_page).length;
        render();
      } catch (err) {
        alert('Erreur : ' + err.message);
        event.target.disabled = false;
        event.target.textContent = activate ? 'Mettre en ligne' : 'Hors ligne';
      }
    };

    /* ---- ACTIONS ---- */
    window.mark = function(slug) {
      tracking[slug] = Date.now();
      saveTracking(tracking);
      render();
    };
    window.unmark = function(slug) {
      delete tracking[slug];
      saveTracking(tracking);
      render();
    };

    /* ---- FILTERS ---- */
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        render();
      });
    });
    document.getElementById('search').addEventListener('input', e => {
      searchQuery = e.target.value;
      render();
    });

    /* ---- CSV IMPORT ---- */
    const csvZone   = document.getElementById('csv-zone');
    const csvFile   = document.getElementById('csv-file');
    const csvResult = document.getElementById('csv-result');
    const csvStats  = document.getElementById('csv-stats');
    let csvPending  = [];

    csvZone.addEventListener('dragover', e => { e.preventDefault(); csvZone.classList.add('drag-over'); });
    csvZone.addEventListener('dragleave', () => csvZone.classList.remove('drag-over'));
    csvZone.addEventListener('drop', e => {
      e.preventDefault();
      csvZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) handleCsv(file);
    });
    csvFile.addEventListener('change', () => {
      if (csvFile.files[0]) handleCsv(csvFile.files[0]);
    });

    function handleCsv(file) {
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target.result;
        const rows = parseCSV(text);
        if (!rows.length) { alert('CSV vide ou invalide'); return; }

        // Slug existants
        const existing = new Set(PROSPECTS.map(p => p.slug));

        // Parser chaque ligne
        const allParsed = rows.map(csvRowToProspect).filter(p => p && p.slug);
        const newOnes   = allParsed.filter(p => !existing.has(p.slug));
        const dupes     = allParsed.length - newOnes.length;

        csvPending = newOnes;
        csvStats.innerHTML =
          '<strong>' + allParsed.length + '</strong> prospects dans le CSV &middot; ' +
          '<strong>' + newOnes.length + '</strong> nouveaux &middot; ' +
          '<strong>' + dupes + '</strong> doublons ignor&eacute;s';
        csvResult.classList.add('visible');
        csvZone.style.display = 'none';
      };
      reader.readAsText(file, 'UTF-8');
    }

    function parseCSV(text) {
      const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return [];
      const headers = parseCSVLine(lines[0]);
      return lines.slice(1).map(line => {
        const vals = parseCSVLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
      });
    }

    function parseCSVLine(line) {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
          if (c === '"' && line[i+1] === '"') { current += '"'; i++; }
          else if (c === '"') { inQuotes = false; }
          else { current += c; }
        } else {
          if (c === '"') { inQuotes = true; }
          else if (c === ',') { result.push(current.trim()); current = ''; }
          else { current += c; }
        }
      }
      result.push(current.trim());
      return result;
    }

    function csvRowToProspect(row) {
      const slug = row.slug;
      if (!slug) return null;
      return {
        slug:        slug,
        prenom:      row.prenom       || '',
        nom:         cleanName(row.nom || row.nom_complet || '', row.metier || ''),
        metier:      row.metier       || '',
        ville:       row.ville        || '',
        departement: row.departement  || '',
        telephone:   row.telephone    || '',
        email:       row.email        || '',
        photo_url:   row.photo_url    || '',
        avis_note:   row.avis_google_note ? parseFloat(row.avis_google_note) : null,
        avis_nb:     row.avis_google_nb   ? parseInt(row.avis_google_nb)     : null,
        horaires:    row.horaires     || '',
        adresse:     row.adresse      || '',
        has_page:    false,
      };
    }

    /* ---- CSV CONFIRM: envoyer au Worker ---- */
    document.getElementById('btn-csv-confirm').addEventListener('click', async () => {
      if (!csvPending.length) return;
      const btn = document.getElementById('btn-csv-confirm');
      btn.disabled = true;

      const BATCH_SIZE = 20;
      let totalCreated = 0;
      let totalSkipped = 0;

      try {
        for (let i = 0; i < csvPending.length; i += BATCH_SIZE) {
          const batch = csvPending.slice(i, i + BATCH_SIZE);
          const progress = Math.min(i + BATCH_SIZE, csvPending.length);
          btn.textContent = 'Import ' + progress + '/' + csvPending.length + '...';

          const res = await fetch(WORKER_URL + '/api/import', {
            method: 'POST',
            headers: adminHeaders(),
            body: JSON.stringify({ prospects: batch }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Erreur serveur');
          totalCreated += data.created || 0;
          totalSkipped += data.skipped || 0;
        }

        PROSPECTS = PROSPECTS.concat(csvPending);
        csvStats.innerHTML = '<strong style="color:var(--green)">&check; ' + totalCreated + ' prospects import&eacute;s, ' + totalSkipped + ' doublons ignor&eacute;s.</strong> Le dashboard sera mis &agrave; jour au prochain d&eacute;ploiement.';
        csvPending = [];
        btn.style.display = 'none';
        document.getElementById('btn-csv-cancel').textContent = 'Fermer';
        render();
      } catch (err) {
        alert('Erreur import : ' + err.message + ' (' + totalCreated + ' cr&eacute;&eacute;s avant erreur)');
        btn.disabled = false;
        btn.textContent = 'Importer';
      }
    });

    document.getElementById('btn-csv-cancel').addEventListener('click', () => {
      csvResult.classList.remove('visible');
      csvZone.style.display = '';
      csvPending = [];
    });

    /* ---- INIT ---- */
    render();
  </script>
</body>
</html>`;
}

generate();
