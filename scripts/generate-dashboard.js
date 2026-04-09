/**
 * generate-dashboard.js
 * Régénère demos/dashboard/index.html à partir des dossiers présents dans demos/
 * Appelé automatiquement par le workflow GitHub Actions.
 */

const fs   = require('fs');
const path = require('path');

const DEMOS_DIR     = path.join(__dirname, '..', 'demos');
const DASHBOARD_DIR = path.join(DEMOS_DIR, 'dashboard');
const OUT_FILE      = path.join(DASHBOARD_DIR, 'index.html');

// Dossiers à ignorer (pas des pages praticiens)
const IGNORE = new Set(['dashboard']);

// Lire les prospects JSON pour enrichir les infos
function loadProspects() {
  const prospectsDir = path.join(__dirname, '..', 'prospects');
  const map = {};
  if (!fs.existsSync(prospectsDir)) return map;
  fs.readdirSync(prospectsDir).filter(f => f.endsWith('.json')).forEach(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(prospectsDir, f), 'utf8'));
      const prospects = Array.isArray(data) ? data : [data];
      prospects.forEach(p => {
        if (p.slug) map[p.slug] = p;
      });
    } catch {}
  });
  return map;
}

function initiales(prenom, nom) {
  return ((prenom || '').charAt(0) + (nom || '').charAt(0)).toUpperCase() || '?';
}

function buildCard(slug, prospect) {
  const prenom  = prospect ? prospect.prenom  : '';
  const nom     = prospect ? prospect.nom     : '';
  const metier  = prospect ? prospect.metier  : slug;
  const ville   = prospect ? prospect.ville   : '';
  const ini     = prospect ? initiales(prenom, nom) : slug.charAt(0).toUpperCase();
  const name    = prospect ? `${prenom} ${nom}`.trim() : slug;

  return `
      <div class="client-card">
        <div style="display:flex;align-items:center;gap:14px">
          <div class="client-avatar">${ini}</div>
          <div class="client-info">
            <div class="client-name">${name}</div>
            <div class="client-meta">
              ${metier ? `<span class="client-metier">${metier}</span>` : ''}
              ${ville  ? `<span>${ville}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="client-url">${slug}.solia.me</div>
        <div class="client-actions">
          <a href="https://${slug}.solia.me" target="_blank" class="btn-view">Voir la page →</a>
          <button class="btn-copy" onclick="copyLink(this,'${slug}')">Copier</button>
        </div>
      </div>`;
}

function generate() {
  if (!fs.existsSync(DASHBOARD_DIR)) fs.mkdirSync(DASHBOARD_DIR, { recursive: true });

  const prospects = loadProspects();

  const slugs = fs.readdirSync(DEMOS_DIR)
    .filter(f => {
      if (IGNORE.has(f)) return false;
      return fs.statSync(path.join(DEMOS_DIR, f)).isDirectory();
    })
    .sort();

  const cards = slugs.map(slug => buildCard(slug, prospects[slug] || null)).join('\n');
  const count = slugs.length;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solia — Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; background: #F4EFE8; color: #1A1A18; min-height: 100vh; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    .nav { background: #1A1A18; padding: 0 32px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
    .nav-logo { font-family: 'Playfair Display', serif; font-style: italic; font-size: 1.3rem; font-weight: 600; color: #FDFAF6; }
    .nav-badge { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(253,250,246,0.4); }
    .main { max-width: 960px; margin: 0 auto; padding: 48px 24px 80px; }
    .header { margin-bottom: 40px; }
    .header h1 { font-family: 'Playfair Display', serif; font-size: 1.9rem; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 6px; }
    .header p { font-size: 0.9rem; color: #8A8074; }
    .stats-bar { display: flex; gap: 16px; margin-bottom: 36px; flex-wrap: wrap; }
    .stat-pill { background: #1A1A18; color: #FDFAF6; font-size: 0.8rem; font-weight: 500; padding: 8px 18px; border-radius: 100px; display: flex; align-items: center; gap: 8px; }
    .stat-pill strong { color: #C4704F; font-size: 1rem; font-weight: 700; }
    .clients-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
    .client-card { background: #FDFAF6; border-radius: 16px; padding: 28px; border: 1.5px solid rgba(26,26,24,0.06); transition: box-shadow 0.2s, transform 0.2s; display: flex; flex-direction: column; gap: 16px; }
    .client-card:hover { box-shadow: 0 8px 32px rgba(26,26,24,0.10); transform: translateY(-2px); }
    .client-avatar { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #C4704F, #E8956A); display: flex; align-items: center; justify-content: center; font-family: 'Playfair Display', serif; font-size: 1.1rem; font-weight: 600; color: #FDFAF6; flex-shrink: 0; }
    .client-info { flex: 1; }
    .client-name { font-family: 'Playfair Display', serif; font-size: 1.05rem; font-weight: 600; margin-bottom: 4px; }
    .client-meta { font-size: 0.8rem; color: #8A8074; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .client-metier { background: rgba(196,112,79,0.1); color: #C4704F; font-weight: 500; padding: 2px 10px; border-radius: 100px; font-size: 0.75rem; }
    .client-url { font-size: 0.75rem; color: #8A8074; font-family: monospace; background: #F4EFE8; padding: 8px 12px; border-radius: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .client-actions { display: flex; gap: 10px; }
    .btn-view { flex: 1; display: flex; align-items: center; justify-content: center; background: #C4704F; color: #FDFAF6; font-size: 0.82rem; font-weight: 600; padding: 10px 16px; border-radius: 100px; transition: background 0.2s; }
    .btn-view:hover { background: #B05F40; }
    .btn-copy { display: flex; align-items: center; justify-content: center; border: 1.5px solid rgba(26,26,24,0.15); color: #1A1A18; font-size: 0.82rem; font-weight: 500; padding: 10px 16px; border-radius: 100px; cursor: pointer; background: none; transition: border-color 0.2s, color 0.2s; font-family: 'DM Sans', sans-serif; }
    .btn-copy:hover { border-color: #C4704F; color: #C4704F; }
    .btn-copy.copied { border-color: #4CAF50; color: #4CAF50; }
    .empty { grid-column: 1 / -1; text-align: center; padding: 64px 24px; color: #8A8074; }
  </style>
</head>
<body>
  <nav class="nav">
    <span class="nav-logo">Solia</span>
    <span class="nav-badge">Dashboard</span>
  </nav>
  <main class="main">
    <div class="header">
      <h1>Mes clients</h1>
      <p>Pages en ligne — accès réservé</p>
    </div>
    <div class="stats-bar">
      <div class="stat-pill"><strong>${count}</strong> page${count > 1 ? 's' : ''} en ligne</div>
    </div>
    <div class="clients-grid">
      ${count === 0 ? '<div class="empty"><p>Aucune page générée pour l\'instant.</p></div>' : cards}
    </div>
  </main>
  <script>
    function copyLink(btn, slug) {
      const url = 'https://' + slug + '.solia.me';
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = '✓ Copié';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copier'; btn.classList.remove('copied'); }, 2000);
      });
    }
  </script>
</body>
</html>`;

  fs.writeFileSync(OUT_FILE, html, 'utf8');
  console.log(`Dashboard généré — ${count} client(s).`);
}

generate();
