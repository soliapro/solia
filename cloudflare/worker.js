/**
 * Solia Subdomain Worker
 * Cloudflare Worker — intercepte *.solia.me et sert la bonne page
 *
 * Routing :
 *   solia.me                          → landing page (demos/index.html)
 *   solia.me/formulaire/*             → formulaire de contact
 *   www.solia.me                      → landing page
 *   dashboard.solia.me                → dashboard
 *   formulaire.solia.me               → formulaire de contact
 *   [slug].solia.me                   → page praticien (demos/[slug]/index.html)
 *
 * Les fichiers sont servis depuis GitHub Pages :
 *   https://soliapro.github.io/solia-site/[path]
 */

const GITHUB_BASE = 'https://soliapro.github.io/solia';

// Sous-domaines réservés (pas des slugs praticiens)
const RESERVED = new Set(['www', 'dashboard', 'formulaire', 'mail', 'smtp', 'ftp', 'api']);

export default {
  async fetch(request) {
    const url  = new URL(request.url);
    const host = url.hostname;

    // Extraire le sous-domaine (ex: "slug" depuis "slug.solia.me")
    const subdomain = host.replace(/\.solia\.me$/, '');

    let basePath;

    if (subdomain === host || subdomain === 'www') {
      // Racine solia.me ou www.solia.me → sert depuis /demos/
      basePath = '';
    } else if (subdomain === 'dashboard') {
      basePath = '/dashboard';
    } else if (subdomain === 'formulaire') {
      basePath = '/formulaire';
    } else if (RESERVED.has(subdomain)) {
      return new Response('Not found', { status: 404 });
    } else {
      // Slug praticien → sert depuis /demos/[slug]/
      basePath = `/${subdomain}`;
    }

    // Construire le chemin final sur GitHub Pages
    // Pour les sous-domaines praticiens : sert uniquement index.html (pas de sous-chemins)
    // Pour le domaine racine : passe le pathname complet (pour /formulaire/, assets, etc.)
    let fetchPath;
    if (!RESERVED.has(subdomain) && subdomain !== host && subdomain !== 'www') {
      // Sous-domaine praticien → toujours servir index.html
      fetchPath = `${basePath}/index.html`;
    } else {
      // Domaine racine ou sous-domaine réservé → passer le chemin tel quel
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      // Ajouter /index.html si le chemin finit par /
      const resolvedPath = pathname.endsWith('/')
        ? `${pathname}index.html`
        : pathname;
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

    // Retransmettre la réponse avec headers corrigés
    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-Served-By', 'Solia-Worker');

    // Content-Type correct selon l'extension
    const ext = fetchPath.split('.').pop();
    const MIME = {
      html: 'text/html; charset=utf-8',
      css:  'text/css',
      js:   'application/javascript',
      json: 'application/json',
      png:  'image/png',
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      svg:  'image/svg+xml',
      ico:  'image/x-icon',
      woff: 'font/woff',
      woff2:'font/woff2',
    };
    if (MIME[ext]) newHeaders.set('Content-Type', MIME[ext]);

    // Cache 10 min pour les assets statiques
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
