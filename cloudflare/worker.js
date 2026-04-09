/**
 * Solia Subdomain Worker
 * Cloudflare Worker — intercepte *.solia.me et sert la bonne page
 *
 * Routing :
 *   solia.me                          → landing page
 *   www.solia.me                      → landing page
 *   dashboard.solia.me                → dashboard
 *   [slug].solia.me                   → page praticien
 *
 * Les fichiers sont servis depuis GitHub Pages :
 *   https://soliapro.github.io/solia/[path]
 */

const GITHUB_BASE = 'https://soliapro.github.io/solia';

// Sous-domaines réservés (pas des slugs praticiens)
const RESERVED = new Set(['www', 'dashboard', 'mail', 'smtp', 'ftp']);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname; // ex: dominique-carry-sophrologue-poitiers.solia.me

    // Extraire le sous-domaine
    const subdomain = host.replace(/\.solia\.me$/, '');

    let targetPath;

    if (subdomain === 'solia.me' || subdomain === 'www' || host === 'solia.me') {
      // Racine → landing page
      targetPath = '/';
    } else if (subdomain === 'dashboard') {
      targetPath = '/dashboard/';
    } else if (RESERVED.has(subdomain)) {
      return new Response('Not found', { status: 404 });
    } else {
      // Slug praticien
      targetPath = `/${subdomain}/`;
    }

    // Construire l'URL GitHub Pages à fetcher
    const fetchUrl = `${GITHUB_BASE}${targetPath}${url.pathname === '/' ? '' : url.pathname}${url.search}`;

    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Solia-Worker/1.0' }
    });

    if (!response.ok && response.status !== 304) {
      return new Response('Page introuvable', {
        status: response.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // Retransmettre la réponse en corrigeant les headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-Served-By', 'Solia-Worker');
    // Activer cache 10 min pour les assets
    if (url.pathname.match(/\.(css|js|woff2?|png|jpg|webp|svg|ico)$/)) {
      newHeaders.set('Cache-Control', 'public, max-age=600');
    }

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders
    });
  }
};
