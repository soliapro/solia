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

  const prospectsJson = JSON.stringify(prospects);
  const html = buildHtml(prospectsJson, total, withPage, withPhone);

  fs.writeFileSync(OUT_FILE, html, 'utf8');
  console.log(`Dashboard généré — ${total} prospect(s), ${withPage} page(s) en ligne.`);
}

/* ─── HTML ─── */

function buildHtml(prospectsJson, total, withPage, withPhone) {
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

    .actions { display: flex; gap: 6px; flex-wrap: nowrap; }
    .btn-sm { font-family: var(--ff-sans); font-size: 0.72rem; font-weight: 600; padding: 6px 12px; border-radius: 100px; cursor: pointer; border: 1.5px solid var(--border); background: var(--bg-card); color: var(--dark); transition: all 0.2s; white-space: nowrap; }
    .btn-sm:hover { border-color: var(--accent); color: var(--accent); }
    .btn-sm.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-sm.btn-primary:hover { background: var(--accent-d); }
    .btn-sm.btn-done { background: var(--green-bg); color: var(--green); border-color: rgba(46,125,50,0.2); }

    .empty-row td { text-align: center; padding: 48px; color: var(--muted); font-size: 0.9rem; }

    @media (max-width: 768px) {
      .prospect-table { font-size: 0.8rem; }
      .hide-mobile { display: none; }
      .main { padding: 20px 12px 60px; }
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
      <div class="stat-pill"><strong id="stat-contacted">0</strong> prospect&eacute;s</div>
    </div>

    <div class="filters">
      <input type="text" class="search-input" id="search" placeholder="Rechercher un nom, m&eacute;tier, ville...">
      <button class="filter-btn active" data-filter="all">Tous</button>
      <button class="filter-btn" data-filter="not-contacted">Pas prospect&eacute;s</button>
      <button class="filter-btn" data-filter="contacted">Prospect&eacute;s</button>
      <button class="filter-btn" data-filter="has-page">Page en ligne</button>
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
          const hay = (p.prenom + ' ' + p.nom + ' ' + p.metier + ' ' + p.ville).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        const t = tracking[p.slug];
        if (currentFilter === 'contacted' && !t) return false;
        if (currentFilter === 'not-contacted' && t) return false;
        if (currentFilter === 'has-page' && !p.has_page) return false;
        return true;
      });

      document.getElementById('stat-total').textContent = PROSPECTS.length;
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

        return '<tr>' +
          '<td>' +
            '<div class="cell-name">' + esc(name) + '</div>' +
            '<div class="cell-meta">' + esc(p.metier) + ' &middot; ' + esc(p.ville) + (p.departement ? ' (' + esc(p.departement) + ')' : '') + '</div>' +
          '</td>' +
          '<td class="cell-phone">' +
            (p.telephone ? '<a href="tel:' + esc(phoneRaw) + '">' + esc(p.telephone) + '</a>' : '<span style="color:var(--border)">&mdash;</span>') +
          '</td>' +
          '<td class="hide-mobile cell-avis">' +
            (p.avis_note ? '<span class="star">&#9733;</span> ' + p.avis_note + '/5 <span style="color:var(--muted)">(' + p.avis_nb + ')</span>' : '<span style="color:var(--border)">&mdash;</span>') +
          '</td>' +
          '<td class="hide-mobile">' +
            (p.has_page ? '<span class="badge badge-page">En ligne</span>' : '<span class="badge badge-no-page">Pas de page</span>') +
            (t ? ' <span class="badge badge-contacted">' + dateStr + '</span>' : '') +
          '</td>' +
          '<td class="actions">' +
            '<a href="https://solia.me/formulaire/?prospect=' + p.slug + '" target="_blank" class="btn-sm' + (p.has_page ? ' btn-primary' : '') + '">' + (p.has_page ? 'Lien prospect' : 'Formulaire') + '</a>' +
            (t
              ? '<button class="btn-sm btn-done" onclick="unmark(\\'' + p.slug + '\\')">&check; ' + dateStr + '</button>'
              : '<button class="btn-sm" onclick="mark(\\'' + p.slug + '\\')">Prospect&eacute;</button>'
            ) +
          '</td>' +
        '</tr>';
      }).join('');
    }

    function esc(s) {
      if (!s) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

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
      btn.textContent = 'Import en cours...';

      try {
        const res = await fetch(WORKER_URL + '/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prospects: csvPending }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur serveur');

        // Ajouter les nouveaux prospects à la liste locale
        PROSPECTS = PROSPECTS.concat(csvPending);
        csvStats.innerHTML = '<strong style="color:var(--green)">&check; ' + csvPending.length + ' prospects import&eacute;s.</strong> Le dashboard sera mis &agrave; jour au prochain d&eacute;ploiement.';
        csvPending = [];
        btn.style.display = 'none';
        document.getElementById('btn-csv-cancel').textContent = 'Fermer';
        render();
      } catch (err) {
        alert('Erreur import : ' + err.message);
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
