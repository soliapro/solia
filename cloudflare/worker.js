/**
 * Solia Subdomain Worker
 * Cloudflare Worker — intercepte *.solia.me et sert la bonne page
 *
 * Routing :
 *   solia.me                          → landing page
 *   www.solia.me                      → landing page
 *   dashboard.solia.me                → dashboard
 *   formulaire.solia.me               → formulaire
 *   [slug].solia.me                   → page praticien (verifie D1 avant)
 *
 * Verification en temps reel :
 *   Avant de servir une page praticien, le worker verifie le statut
 *   via /api/page-active/:slug. Si la page est desactivee ou le trial
 *   expire, une page "desactivee" est affichee avec le bon CTA.
 */

const GITHUB_BASE = 'https://soliapro.github.io/solia';
const ENRICHMENT_API = 'https://solia-enrichment.damien-reiss.workers.dev';

const RESERVED = new Set(['www', 'dashboard', 'formulaire', 'mail', 'smtp', 'ftp', 'api']);

/* ─── Page desactivee ─── */

function deactivatedPage(data) {
  const name = [data.prenom, data.nom].filter(Boolean).join(' ') || 'Ce praticien';
  const metier = data.metier || '';
  const ville = data.ville || '';
  const subtitle = [metier, ville].filter(Boolean).join(' à ');

  const isTrialExpired = data.reason === 'trial_expired';
  const isPaid = data.paid === true;

  let message, ctaHtml;

  if (isPaid) {
    // Deja paye → bouton de reactivation directe
    message = 'Votre page a été temporairement désactivée.';
    ctaHtml = `<a href="${ENRICHMENT_API}/api/reactivate/${data.slug || ''}" class="btn btn-primary">Réactiver ma page</a>`;
  } else if (isTrialExpired) {
    // Trial expire → lien vers paiement
    message = 'Votre période d\'essai gratuite est terminée.';
    ctaHtml = `
      <p class="sub">Pour continuer à profiter de votre page professionnelle, activez votre abonnement.</p>
      <a href="https://solia.me/formulaire/?prospect=${data.slug || ''}" class="btn btn-primary">Activer ma page — 9,90€/mois</a>
      <p class="note">Sans engagement · Annulation en 1 clic</p>
    `;
  } else {
    // Desactive manuellement (admin)
    message = 'Cette page n\'est pas disponible pour le moment.';
    ctaHtml = `<a href="https://solia.me" class="btn">Découvrir Solia</a>`;
  }

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(name)} — Page désactivée</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', system-ui, sans-serif;
      background: #F4EFE8;
      color: #1A1A18;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #fff;
      border-radius: 20px;
      padding: 48px 36px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(26,26,24,0.08);
    }
    .logo { color: #C4704F; font-size: 1.1rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 32px; }
    .initials {
      width: 72px; height: 72px;
      border-radius: 50%;
      background: #C4704F;
      color: #fff;
      font-size: 1.5rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
    }
    h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: 4px; }
    .subtitle { font-size: 0.85rem; color: #8A8074; margin-bottom: 24px; }
    .message { font-size: 0.95rem; color: #1A1A18; margin-bottom: 24px; line-height: 1.5; }
    .sub { font-size: 0.85rem; color: #8A8074; margin-bottom: 16px; line-height: 1.4; }
    .btn {
      display: inline-block;
      padding: 14px 32px;
      border-radius: 100px;
      font-family: 'DM Sans', sans-serif;
      font-size: 0.95rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s;
      border: none;
      cursor: pointer;
    }
    .btn-primary { background: #C4704F; color: #fff; }
    .btn-primary:hover { background: #A85C3E; }
    .btn { background: #F4EFE8; color: #1A1A18; }
    .btn:hover { background: #E4DDD4; }
    .note { font-size: 0.75rem; color: #aaa; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Solia</div>
    <div class="initials">${esc(initials(data.prenom, data.nom))}</div>
    <h1>${esc(name)}</h1>
    ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
    <p class="message">${message}</p>
    ${ctaHtml}
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function initials(prenom, nom) {
  return ((prenom || '').charAt(0) + (nom || '').charAt(0)).toUpperCase() || '?';
}

/* ─── Worker ─── */

export default {
  async fetch(request) {
    const url  = new URL(request.url);
    const host = url.hostname;
    const subdomain = host.replace(/\.solia\.me$/, '');

    let basePath;
    let isPractitionerPage = false;

    if (subdomain === host || subdomain === 'www') {
      // Bloquer l'acces a /dashboard et /formulaire depuis solia.me
      // Rediriger vers les sous-domaines
      if (url.pathname.startsWith('/dashboard')) {
        return Response.redirect('https://dashboard.solia.me/', 301);
      }
      if (url.pathname.startsWith('/formulaire')) {
        return Response.redirect('https://formulaire.solia.me/' + url.pathname.replace('/formulaire', '').replace(/^\//, '') + url.search, 301);
      }
      basePath = '';
    } else if (subdomain === 'dashboard') {
      basePath = '/dashboard';
    } else if (subdomain === 'formulaire') {
      basePath = '/formulaire';
    } else if (RESERVED.has(subdomain)) {
      return new Response('Not found', { status: 404 });
    } else {
      basePath = `/${subdomain}`;
      isPractitionerPage = true;
    }

    // Verification instantanee : page active ?
    if (isPractitionerPage) {
      try {
        const check = await fetch(`${ENRICHMENT_API}/api/page-active/${subdomain}`);
        if (check.ok) {
          const data = await check.json();
          if (data.active === false) {
            data.slug = subdomain;
            return deactivatedPage(data);
          }
        }
      } catch (e) {
        // API down → on laisse passer
      }
    }

    // Servir depuis GitHub Pages
    let fetchPath;
    if (isPractitionerPage) {
      fetchPath = `${basePath}/index.html`;
    } else {
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const resolvedPath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      fetchPath = `${basePath}${resolvedPath}`;
    }

    const fetchUrl = `${GITHUB_BASE}${fetchPath}${url.search}`;

    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Solia-Worker/1.0' }
    });

    if (!response.ok && response.status !== 304) {
      return new Response('Page introuvable', {
        status: response.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-Served-By', 'Solia-Worker');

    const ext = fetchPath.split('.').pop();
    const MIME = {
      html: 'text/html; charset=utf-8', css: 'text/css', js: 'application/javascript',
      json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
      woff: 'font/woff', woff2: 'font/woff2',
    };
    if (MIME[ext]) newHeaders.set('Content-Type', MIME[ext]);

    if (ext && ext !== 'html') {
      newHeaders.set('Cache-Control', 'public, max-age=600');
    } else {
      newHeaders.set('Cache-Control', 'public, max-age=60');
    }

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  }
};
