/**
 * Cloudflare Worker — solia-enrichment.js
 *
 * Routes :
 *   POST /api/personalize       → Enrichit le JSON via Claude, commit sur GitHub, trigger rebuild
 *   POST /api/toggle-page       → Met en ligne / hors ligne une page démo prospect
 *   POST /api/publish           → Publie une page (demo → payée)
 *   POST /api/import            → Import bulk de prospects (depuis CSV dashboard)
 *   POST /api/stripe-webhook    → Webhook Stripe (checkout.session.completed, customer.subscription.deleted)
 *   GET  /api/status/:slug      → Vérifie si la page a été reconstruite récemment
 *   GET  /api/prospect/:slug    → Retourne les données de base du prospect (pré-remplissage form)
 *
 * Variables d'environnement (Cloudflare Secrets) :
 *   ANTHROPIC_API_KEY   → à brancher quand disponible
 *   GITHUB_TOKEN        → Personal Access Token, scope: repo
 *   STRIPE_WEBHOOK_SECRET → whsec_... pour vérifier les signatures Stripe
 *   BREVO_API_KEY       → clé API Brevo pour les emails transactionnels
 *
 * Variables wrangler.toml :
 *   REPO_OWNER          → soliapro
 *   REPO_NAME           → solia
 */

/* ═══════════════════════════════════════════════════════
   CONSTANTES
═══════════════════════════════════════════════════════ */

const CLAUDE_MODEL   = 'claude-sonnet-4-20250514';
const CLAUDE_MAX_TOK = 1500;
const GITHUB_API     = 'https://api.github.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ═══════════════════════════════════════════════════════
   ENTRY POINT
═══════════════════════════════════════════════════════ */

export default {
  /* Cron Trigger — séquence emails J1/J3/J6 */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledHandler(env));
  },

  async fetch(request, env) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /api/personalize
      if (request.method === 'POST' && path === '/api/personalize') {
        return await handlePersonalize(request, env);
      }

      // POST /api/toggle-page
      if (request.method === 'POST' && path === '/api/toggle-page') {
        return await handleTogglePage(request, env);
      }

      // POST /api/publish
      if (request.method === 'POST' && path === '/api/publish') {
        return await handlePublish(request, env);
      }

      // POST /api/import
      if (request.method === 'POST' && path === '/api/import') {
        return await handleImport(request, env);
      }

      // POST /api/stripe-webhook
      if (request.method === 'POST' && path === '/api/stripe-webhook') {
        return await handleStripeWebhook(request, env);
      }

      // GET /api/status/:slug
      if (request.method === 'GET' && path.startsWith('/api/status/')) {
        const slug = path.replace('/api/status/', '').replace(/\/$/, '');
        return await handleStatus(slug, env);
      }

      // GET /api/prospect/:slug
      if (request.method === 'GET' && path.startsWith('/api/prospect/')) {
        const slug = path.replace('/api/prospect/', '').replace(/\/$/, '');
        return await handleProspect(slug, env, url);
      }

      return jsonResponse({ error: 'Route introuvable' }, 404);

    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: err.message || 'Erreur interne' }, 500);
    }
  }
};

/* ═══════════════════════════════════════════════════════
   ROUTE — POST /api/personalize
═══════════════════════════════════════════════════════ */

async function handlePersonalize(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Corps JSON invalide' }, 400);
  }

  const { slug, email } = body;

  if (!slug)  return jsonResponse({ error: 'Champ "slug" requis' }, 400);
  if (!email) return jsonResponse({ error: 'Champ "email" requis' }, 400);

  // 1. Récupérer le JSON prospect depuis GitHub (ou créer un nouveau)
  let prospect, sha;
  let isNewProspect = false;
  try {
    ({ prospect, sha } = await getProspectFromGitHub(slug, env));
  } catch {
    // Nouveau prospect (inscription organique depuis le formulaire)
    prospect = { slug, source: 'organic' };
    sha = null;
    isNewProspect = true;
  }

  // Préserver la source si déjà définie, sinon déduire
  if (!prospect.source) {
    prospect.source = isNewProspect ? 'organic' : 'prospected';
  }

  // 1b. Fixer la date de création pour le compteur UNE SEULE FOIS
  //     Ne jamais écraser → le compteur ne se reset plus à chaque modif
  if (!prospect.demo_created_at) prospect.demo_created_at = new Date().toISOString();

  // 2. Enrichir via Claude (placeholder tant que la clé n'est pas branchée)
  const enriched = await enrichWithClaude(body, prospect, env);

  // 3. Fusionner les données dans le prospect
  const updated = mergeProspect(prospect, body, enriched);

  // 4. Committer les photos si présentes AVANT le JSON (pour que photo_url soit dans le JSON)
  if (body.photo_profil && typeof body.photo_profil === 'string' && body.photo_profil.includes(',')) {
    await commitImageToGitHub(slug, 'profil.jpg', body.photo_profil, env);
    updated.photo_url = `https://soliapro.github.io/solia/${slug}/img/profil.jpg`;
  }
  if (Array.isArray(body.photos_cabinet)) {
    for (let i = 0; i < Math.min(body.photos_cabinet.length, 5); i++) {
      if (typeof body.photos_cabinet[i] === 'string' && body.photos_cabinet[i].includes(',')) {
        await commitImageToGitHub(slug, `cabinet-${i + 1}.jpg`, body.photos_cabinet[i], env);
      }
    }
  }

  // 5. Générer un edit_token si absent (pour édition post-pub)
  if (!updated.edit_token) {
    updated.edit_token = generateToken();
  }

  // 6. Committer le JSON mis à jour sur GitHub (avec photo_url)
  await commitProspectToGitHub(slug, updated, sha, env);

  // 7. Trigger le rebuild GitHub Actions
  await triggerRebuild(slug, env);

  // 8. Envoyer l'email J1 pour les nouveaux prospects organiques
  if (isNewProspect && updated.email) {
    await sendTrialSequenceEmail(env, updated, 1);
    // Marquer l'email comme envoyé (sera persisté au prochain commit)
    updated.emails_sent = ['j1'];
  }

  return jsonResponse({
    status:  'building',
    slug,
    message: 'Votre page est en cours de mise à jour',
  });
}

/* ═══════════════════════════════════════════════════════
   ROUTE — GET /api/status/:slug
═══════════════════════════════════════════════════════ */

async function handleStatus(slug, env) {
  // Vérifier la date du dernier commit sur demos/[slug]/index.html
  const commitsUrl = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/commits`
    + `?path=demos/${encodeURIComponent(slug)}/index.html&per_page=1`;

  const res = await githubFetch(commitsUrl, env);

  if (!res.ok) {
    return jsonResponse({ status: 'unknown' });
  }

  const commits = await res.json();
  if (!commits.length) {
    return jsonResponse({ status: 'not-found' });
  }

  const lastCommitDate = new Date(commits[0].commit.committer.date);
  const minutesAgo     = (Date.now() - lastCommitDate.getTime()) / 60_000;

  // Reconstruit dans les 8 dernières minutes → ready
  if (minutesAgo < 8) {
    return jsonResponse({
      status:    'ready',
      url:       `https://${slug}.solia.me`,
      updatedAt: lastCommitDate.toISOString(),
    });
  }

  return jsonResponse({ status: 'building' });
}

/* ═══════════════════════════════════════════════════════
   ROUTE — GET /api/prospect/:slug
═══════════════════════════════════════════════════════ */

async function handleProspect(slug, env, url) {
  let prospect, sha;
  try {
    ({ prospect, sha } = await getProspectFromGitHub(slug, env));
  } catch (err) {
    return jsonResponse({ error: `Prospect introuvable : ${slug}` }, 404);
  }

  // Vérifier le token d'édition si prospect publié
  const token = url.searchParams.get('token');
  const isPublished = prospect.published === true;

  // Si publié et token requis, vérifier
  if (isPublished && prospect.edit_token && token !== prospect.edit_token) {
    return jsonResponse({ error: 'Token invalide', published: true }, 403);
  }

  // Retourner tous les champs utiles pour le pré-remplissage
  const safe = {
    slug:              prospect.slug,
    prenom:            prospect.prenom            || '',
    nom:               prospect.nom               || '',
    metier:            prospect.metier            || '',
    ville:             prospect.ville             || '',
    email:             prospect.email             || '',
    telephone:         prospect.telephone         || '',
    adresse:           prospect.adresse           || '',
    horaires:          prospect.horaires          || '',
    tarif:             prospect.tarif             || '',
    duree_seance:      prospect.duree_seance      || '',
    description:       prospect.description       || '',
    approche:          prospect.approche          || '',
    specialites:       prospect.specialites       || [],
    theme:             prospect.theme             || '',
    photo_url:         prospect.photo_url         || '',
    avis_google_note:  prospect.avis_google_note  ?? null,
    avis_google_nb:    prospect.avis_google_nb    ?? null,
    published:         isPublished,
  };

  return jsonResponse(safe);
}

/* ═══════════════════════════════════════════════════════
   CLAUDE — Enrichissement (placeholder activable)
═══════════════════════════════════════════════════════ */

const CLAUDE_SYSTEM = `Tu es un expert en rédaction web et SEO local pour indépendants du bien-être.
Le prospect a rempli un formulaire pour personnaliser sa page vitrine.
À partir de ses réponses, génère un contenu optimisé SEO tout en restant fidèle à ce qu'il a écrit.
Ne change pas le sens, améliore la forme. Garde son ton et sa personnalité.
Réponds UNIQUEMENT en JSON valide, sans markdown ni bloc de code.`;

function buildClaudePrompt(formData, prospect) {
  const activite = formData.metier || prospect.metier || '';
  const ville    = formData.ville  || prospect.ville  || '';
  return `
Praticien : ${activite} à ${ville}
${prospect.avis_google_note ? `Note Google : ${prospect.avis_google_note}/5 (${prospect.avis_google_nb} avis)` : ''}

Description fournie par le praticien :
${formData.description || '(non renseignée)'}

Services listés :
${formData.services || '(non renseignés)'}

Points différenciateurs :
${formData.arguments || '(non renseignés)'}

Horaires : ${formData.horaires || prospect.horaires || 'non renseignés'}

Génère ce JSON :
{
  "titre": "accroche percutante incluant ${activite} (max 10 mots)",
  "description": "4-5 phrases optimisées SEO, incluent ${activite} et ${ville}",
  "approche": "2-3 phrases sur la méthode de travail",
  "specialites": ["service 1 optimisé", "service 2", "service 3", "service 4", "service 5"],
  "arguments": ["point fort 1", "point fort 2", "point fort 3"],
  "horaires": "horaires reformatés proprement",
  "meta_description": "max 155 car, inclut ${activite} à ${ville}",
  "meta_title": "${activite} à ${ville} | [Nom du praticien]"
}`.trim();
}

async function enrichWithClaude(formData, prospect, env) {
  // ─────────────────────────────────────────────────────────
  // TODO : décommenter ce bloc dès que ANTHROPIC_API_KEY
  //        est configurée dans les secrets Cloudflare.
  //
  // if (env.ANTHROPIC_API_KEY) {
  //   const response = await fetch('https://api.anthropic.com/v1/messages', {
  //     method: 'POST',
  //     headers: {
  //       'x-api-key':         env.ANTHROPIC_API_KEY,
  //       'anthropic-version': '2023-06-01',
  //       'content-type':      'application/json',
  //     },
  //     body: JSON.stringify({
  //       model:      CLAUDE_MODEL,
  //       max_tokens: CLAUDE_MAX_TOK,
  //       system:     CLAUDE_SYSTEM,
  //       messages:   [{ role: 'user', content: buildClaudePrompt(formData, prospect) }],
  //     }),
  //   });
  //
  //   if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  //
  //   const data  = await response.json();
  //   const raw   = data.content[0].text.trim();
  //   const match = raw.match(/\{[\s\S]*\}/);
  //   if (!match) throw new Error('Claude n\'a pas retourné de JSON valide');
  //   return JSON.parse(match[0]);
  // }
  // ─────────────────────────────────────────────────────────

  // Placeholder — retourne les données du formulaire sans enrichissement Claude
  // La page sera générée avec le texte brut du praticien.
  return {
    description: formData.description || prospect.description || '',
    approche:    formData.arguments   || prospect.approche    || '',
    specialites: parseLines(formData.services),
    horaires:    formData.horaires    || prospect.horaires    || '',
    meta_title:  `${formData.metier || prospect.metier} à ${formData.ville || prospect.ville}`,
  };
}

/* ═══════════════════════════════════════════════════════
   FUSION DES DONNÉES
═══════════════════════════════════════════════════════ */

function mergeProspect(prospect, formData, enriched) {
  // Helper : si le champ est envoyé par le formulaire (même vide), on le prend.
  // Sinon on garde la valeur existante du prospect.
  function pick(field, fallback) {
    if (field in formData) return formData[field];
    if (field in enriched) return enriched[field];
    return prospect[field] ?? fallback;
  }

  return {
    ...prospect,
    // Infos de base
    prenom:       pick('prenom', ''),
    nom:          pick('nom', ''),
    metier:       pick('metier', ''),
    ville:        pick('ville', ''),
    telephone:    pick('telephone', ''),
    email:        pick('email', ''),
    // Contenu
    description:  enriched.description || pick('description', ''),
    approche:     enriched.approche    || pick('approche', ''),
    specialites:  enriched.specialites?.length
                    ? enriched.specialites
                    : ('services' in formData
                        ? (formData.services || '').split('\n').map(s => s.trim()).filter(Boolean)
                        : prospect.specialites || []),
    horaires:     pick('horaires', ''),
    tarif:        pick('tarif', ''),
    duree_seance: pick('duree_seance', ''),
    // Réseaux sociaux
    instagram_url:    pick('instagram_url', ''),
    facebook_url:     pick('facebook_url', ''),
    linkedin_url:     pick('linkedin_url', ''),
    site_actuel:      pick('site_actuel', ''),
    whatsapp_url:     pick('whatsapp_url', ''),
    // Infos pratiques
    adresse:           pick('adresse', ''),
    zone_intervention: pick('zone_intervention', ''),
    publics:           'publics' in formData ? (formData.publics || []) : prospect.publics || [],
    rdv_url:           pick('rdv_url', ''),
    cta_text:          pick('cta_text', ''),
    contact_title:     pick('contact_title', ''),
    annees_experience: pick('annees_experience', ''),
    formations:        'formations' in formData ? (formData.formations || []) : prospect.formations || [],
    // Thème visuel
    theme:        pick('theme', ''),
    // Flags
    email_confirme: true,
    page_active:    true,
  };
}

/* ═══════════════════════════════════════════════════════
   GITHUB API — Helpers
═══════════════════════════════════════════════════════ */

function githubFetch(url, env, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept':        'application/vnd.github.v3+json',
      'User-Agent':    'Solia-Worker/1.0',
      ...(options.headers || {}),
    },
  });
}

async function getProspectFromGitHub(slug, env) {
  const url = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/prospects/${slug}.json`;
  const res = await githubFetch(url, env);

  if (!res.ok) {
    const status = res.status;
    throw new Error(status === 404
      ? `Prospect non trouvé : ${slug}`
      : `GitHub API error ${status}`
    );
  }

  const data    = await res.json();
  // Décodage base64 → UTF-8 propre (atob seul casse les caractères multi-octets)
  const binary  = atob(data.content.replace(/\n/g, ''));
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const content = new TextDecoder().decode(bytes);
  let   parsed  = JSON.parse(content);

  // Normalise : un JSON peut être un tableau (format legacy exemple.json)
  if (Array.isArray(parsed)) parsed = parsed[0];

  return { prospect: parsed, sha: data.sha };
}

async function commitProspectToGitHub(slug, prospect, sha, env) {
  const url     = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/prospects/${slug}.json`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(prospect, null, 2))));

  const res = await githubFetch(url, env, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({
      message: sha ? `feat(prospect): mise à jour ${slug}` : `feat(prospect): nouveau ${slug} (inscription)`,
      content,
    }, sha ? { sha } : {})),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Commit JSON échoué : ${err.message || res.status}`);
  }
}

async function commitImageToGitHub(slug, filename, dataUri, env) {
  // dataUri = "data:image/jpeg;base64,/9j/4AAQ..."
  const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
  const url     = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/demos/${slug}/img/${filename}`;

  // Vérifie si le fichier existe déjà pour récupérer son SHA
  let sha;
  const check = await githubFetch(url, env);
  if (check.ok) {
    const existing = await check.json();
    sha = existing.sha;
  }

  const body = {
    message: `feat(img): upload ${filename} pour ${slug}`,
    content: base64,
  };
  if (sha) body.sha = sha;

  const res = await githubFetch(url, env, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.warn(`Upload image échoué (${filename}) : ${err.message || res.status}`);
    // Non bloquant — on continue même si l'image échoue
  }
}

async function triggerRebuild(slug, env) {
  const url = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/dispatches`;

  const res = await githubFetch(url, env, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type:     'rebuild-page',
      client_payload: { slug },
    }),
  });

  // 204 = succès sans body pour repository_dispatch
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Dispatch GitHub échoué : ${err.message || res.status}`);
  }
}

/* ═══════════════════════════════════════════════════════
   ROUTE — POST /api/toggle-page
═══════════════════════════════════════════════════════ */

async function handleTogglePage(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'JSON invalide' }, 400); }

  const { slug, active } = body;
  if (!slug) return jsonResponse({ error: 'Champ "slug" requis' }, 400);

  if (active) {
    // ── METTRE EN LIGNE : activer le prospect → GitHub Actions génère avec le vrai template ──
    const { prospect, sha } = await getProspectFromGitHub(slug, env);
    prospect.page_active = true;
    if (!prospect.demo_created_at) prospect.demo_created_at = new Date().toISOString();
    await commitProspectToGitHub(slug, prospect, sha, env);
    await triggerRebuild(slug, env);
    return jsonResponse({ status: 'online', slug, message: 'Page en cours de génération (~1 min)' });
  } else {
    // ── HORS LIGNE : désactiver ──
    const { prospect, sha } = await getProspectFromGitHub(slug, env);
    prospect.page_active = false;
    await commitProspectToGitHub(slug, prospect, sha, env);
    await triggerRebuild(slug, env);
    return jsonResponse({ status: 'offline', slug });
  }
}

/* ═══════════════════════════════════════════════════════
   ROUTE — POST /api/publish
═══════════════════════════════════════════════════════ */

async function handlePublish(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'JSON invalide' }, 400); }

  const { slug } = body;
  if (!slug) return jsonResponse({ error: 'Champ "slug" requis' }, 400);

  const { prospect, sha } = await getProspectFromGitHub(slug, env);
  prospect.published = true;
  prospect.published_at = new Date().toISOString();
  prospect.email_confirme = true;
  prospect.paid = true;
  prospect.paid_at = new Date().toISOString();
  if (!prospect.edit_token) prospect.edit_token = generateToken();
  await commitProspectToGitHub(slug, prospect, sha, env);
  await triggerRebuild(slug, env);

  return jsonResponse({ status: 'published', slug, message: 'Votre page est publiée !' });
}

/* ═══════════════════════════════════════════════════════
   ROUTE — POST /api/import
═══════════════════════════════════════════════════════ */

async function handleImport(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'JSON invalide' }, 400); }

  const prospects = body.prospects;
  if (!Array.isArray(prospects) || !prospects.length) {
    return jsonResponse({ error: 'Tableau "prospects" requis' }, 400);
  }

  let created = 0, skipped = 0;

  for (const p of prospects) {
    if (!p.slug) { skipped++; continue; }

    // Vérifier si le fichier existe déjà
    const checkUrl = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/prospects/${p.slug}.json`;
    const check = await githubFetch(checkUrl, env);
    if (check.ok) { skipped++; continue; }

    // Construire le JSON prospect
    const prospect = {
      slug:           p.slug,
      prenom:         p.prenom         || '',
      nom:            p.nom            || '',
      metier:         p.metier         || '',
      ville:          p.ville          || '',
      departement:    p.departement    || '',
      email:          p.email          || '',
      description:    '',
      email_confirme: false,
      photo_url:      p.photo_url      || '',
      theme:          '',
      telephone:      p.telephone      || '',
      adresse:        p.adresse        || '',
      zone_intervention: '',
      horaires:       p.horaires       || '',
      tarif:          '',
      duree_seance:   '',
      approche:       '',
      specialites:    [],
      formations:     [],
      certifications: [],
      publics:        [],
      annees_experience: null,
      avis_google_note:  p.avis_note ? parseFloat(p.avis_note) : null,
      avis_google_nb:    p.avis_nb   ? parseInt(p.avis_nb)     : null,
      langues:        ['fr'],
      instagram_url:  '',
      source:         'prospected',
      prospected_at:  new Date().toISOString(),
      priorite:       p.priorite || p.priorite_solia || '',
      paid:           false,
    };

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(prospect, null, 2))));
    await githubFetch(checkUrl, env, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `feat(import): ajout prospect ${p.slug}`,
        content,
      }),
    });
    created++;
  }

  // Trigger rebuild pour régénérer le dashboard
  if (created > 0) await triggerRebuild('import', env);

  return jsonResponse({ status: 'ok', created, skipped });
}

/* ═══════════════════════════════════════════════════════
   PAGE DÉMO — Template HTML
═══════════════════════════════════════════════════════ */

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function initials(prenom, nom) {
  return ((prenom || '').charAt(0) + (nom || '').charAt(0)).toUpperCase() || '?';
}

function buildDemoPage(p) {
  const name     = esc([p.prenom, p.nom].filter(Boolean).join(' ') || p.slug);
  const metier   = esc(p.metier || '');
  const ville    = esc(p.ville || '');
  const dept     = esc(p.departement || '');
  const tel      = esc(p.telephone || '');
  const telRaw   = tel.replace(/\s/g, '');
  const adresse  = esc(p.adresse || '');
  const horaires = esc(p.horaires || '').replace(/\|/g, '<br>');
  const ini      = esc(initials(p.prenom, p.nom));
  const formUrl  = `https://solia.me/formulaire/?prospect=${p.slug}`;
  const note     = p.avis_google_note;
  const nb       = p.avis_google_nb;

  const photoHtml = p.photo_url
    ? `<img src="${esc(p.photo_url)}" alt="${name}" style="width:140px;height:140px;border-radius:50%;object-fit:cover;border:4px solid #fff;box-shadow:0 4px 20px rgba(0,0,0,0.12)">`
    : `<div style="width:140px;height:140px;border-radius:50%;background:linear-gradient(135deg,#C4704F,#E8956A);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:3rem;font-weight:600;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.12)">${ini}</div>`;

  const avisHtml = (note && nb)
    ? `<div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:16px">
        <span style="color:#F5A623;font-size:1.2rem">${'&#9733;'.repeat(Math.round(note))}</span>
        <span style="font-size:0.9rem;color:#8A8074">${note}/5 (${nb} avis Google)</span>
      </div>`
    : '';

  const telHtml = tel
    ? `<a href="tel:${telRaw}" style="display:inline-flex;align-items:center;gap:8px;background:#fff;border:1.5px solid #E4DDD4;padding:12px 24px;border-radius:100px;font-size:0.9rem;color:#1A1A18;font-weight:500;transition:all 0.2s;text-decoration:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C4704F" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
        ${tel}
      </a>`
    : '';

  const hoursHtml = horaires
    ? `<div style="background:#fff;border:1.5px solid #E4DDD4;border-radius:14px;padding:20px 24px;text-align:left;max-width:400px;margin:0 auto">
        <div style="font-weight:600;font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#8A8074;margin-bottom:8px">Horaires</div>
        <div style="font-size:0.88rem;line-height:1.8;color:#1A1A18">${horaires}</div>
      </div>`
    : '';

  const adresseHtml = adresse
    ? `<div style="font-size:0.85rem;color:#8A8074;margin-top:8px">${adresse}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${name} — ${metier} à ${ville}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',sans-serif;background:#FDFAF6;color:#1A1A18;-webkit-font-smoothing:antialiased}
    a{color:#C4704F;text-decoration:none}
    .banner{position:fixed;top:0;left:0;width:100%;z-index:9999;background:#C4704F;color:#fff;display:flex;align-items:center;justify-content:center;gap:20px;padding:13px 24px;font-size:0.88rem;font-weight:500;box-shadow:0 2px 16px rgba(0,0,0,0.18);flex-wrap:wrap}
    .banner-btn{background:#fff;color:#C4704F;font-weight:700;font-size:0.82rem;padding:8px 20px;border-radius:100px;white-space:nowrap;transition:opacity 0.2s}
    .banner-btn:hover{opacity:0.85}
    body{padding-top:52px}
  </style>
</head>
<body>
  <div class="banner">
    <span>Ceci est un aper&ccedil;u de votre future page &bull; Personnalisez-la gratuitement</span>
    <a href="${formUrl}" class="banner-btn">Personnaliser ma page &rarr;</a>
  </div>

  <div style="max-width:600px;margin:0 auto;padding:60px 24px 80px;text-align:center">
    <div style="margin-bottom:24px">${photoHtml}</div>
    <h1 style="font-family:'Playfair Display',serif;font-size:clamp(1.6rem,4vw,2.2rem);font-weight:600;margin-bottom:8px">${name}</h1>
    <p style="font-size:1rem;color:#C4704F;font-weight:500;margin-bottom:4px">${metier}</p>
    <p style="font-size:0.9rem;color:#8A8074">${ville}${dept ? ' (' + dept + ')' : ''}</p>
    ${avisHtml}
    ${adresseHtml}

    <div style="margin-top:32px;display:flex;flex-direction:column;align-items:center;gap:12px">
      <a href="${formUrl}" style="display:inline-flex;align-items:center;gap:10px;background:#C4704F;color:#fff;font-weight:600;padding:16px 36px;border-radius:100px;font-size:1rem;transition:background 0.2s">
        Personnaliser ma page &rarr;
      </a>
      ${telHtml}
    </div>

    ${hoursHtml ? '<div style="margin-top:32px">' + hoursHtml + '</div>' : ''}

    <div style="margin-top:48px;padding-top:24px;border-top:1px solid #E4DDD4;font-size:0.78rem;color:#8A8074">
      Page g&eacute;n&eacute;r&eacute;e par <span style="font-family:'Playfair Display',serif;font-style:italic;color:#1A1A18">Solia</span>
    </div>
  </div>
</body>
</html>`;
}

/* ═══════════════════════════════════════════════════════
   GITHUB — Commit / Delete helpers
═══════════════════════════════════════════════════════ */

async function commitFileToGitHub(path, content, message, env) {
  const url = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`;

  // Vérifier si le fichier existe pour récupérer le SHA
  let sha;
  const check = await githubFetch(url, env);
  if (check.ok) {
    const existing = await check.json();
    sha = existing.sha;
  }

  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
  };
  if (sha) body.sha = sha;

  const res = await githubFetch(url, env, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Commit échoué (${path}) : ${err.message || res.status}`);
  }
}

async function deleteFileFromGitHub(path, message, env) {
  const url = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`;

  const check = await githubFetch(url, env);
  if (!check.ok) return; // fichier n'existe pas, rien à faire

  const existing = await check.json();

  const res = await githubFetch(url, env, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha: existing.sha }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Suppression échouée (${path}) : ${err.message || res.status}`);
  }
}

/* ═══════════════════════════════════════════════════════
   ROUTE — POST /api/stripe-webhook
═══════════════════════════════════════════════════════ */

async function handleStripeWebhook(request, env) {
  const body = await request.text();
  const sig  = request.headers.get('stripe-signature');

  // Vérifier la signature Stripe
  if (env.STRIPE_WEBHOOK_SECRET && sig) {
    const valid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) return jsonResponse({ error: 'Signature invalide' }, 401);
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return jsonResponse({ error: 'JSON invalide' }, 400);
  }

  const type = event.type;

  // ── checkout.session.completed → paiement réussi ──
  if (type === 'checkout.session.completed') {
    const session = event.data.object;
    const slug = session.client_reference_id;
    if (!slug) return jsonResponse({ error: 'Pas de client_reference_id' }, 400);

    try {
      const { prospect, sha } = await getProspectFromGitHub(slug, env);
      prospect.published = true;
      prospect.published_at = new Date().toISOString();
      prospect.paid = true;
      prospect.paid_at = new Date().toISOString();
      prospect.stripe_customer_id = session.customer || '';
      prospect.stripe_subscription_id = session.subscription || '';
      prospect.email_confirme = true;
      await commitProspectToGitHub(slug, prospect, sha, env);
      await triggerRebuild(slug, env);

      // Envoyer l'email de bienvenue (J1)
      if (prospect.email) {
        await sendBrevoEmail(env, {
          to: prospect.email,
          toName: [prospect.prenom, prospect.nom].filter(Boolean).join(' '),
          subject: '🎉 Votre page Solia est en ligne !',
          html: buildWelcomeEmail(prospect),
        });
      }

      return jsonResponse({ status: 'published', slug });
    } catch (err) {
      console.error('Stripe checkout error:', err);
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // ── customer.subscription.deleted → résiliation ──
  if (type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const subId = subscription.id;

    // Trouver le prospect par subscription ID
    const slug = await findSlugBySubscription(subId, subscription.metadata, env);
    if (!slug) {
      console.warn('Résiliation: prospect introuvable pour subscription', subId);
      return jsonResponse({ status: 'ignored', reason: 'prospect not found' });
    }

    try {
      const { prospect, sha } = await getProspectFromGitHub(slug, env);
      prospect.paid = false;
      prospect.cancelled_at = new Date().toISOString();
      prospect.page_active = false;
      prospect.published = false;
      await commitProspectToGitHub(slug, prospect, sha, env);
      await triggerRebuild(slug, env);

      // Email de confirmation de résiliation
      if (prospect.email) {
        await sendBrevoEmail(env, {
          to: prospect.email,
          toName: [prospect.prenom, prospect.nom].filter(Boolean).join(' '),
          subject: 'Votre page Solia a été désactivée',
          html: buildCancellationEmail(prospect),
        });
      }

      return jsonResponse({ status: 'cancelled', slug });
    } catch (err) {
      console.error('Stripe cancellation error:', err);
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // ── invoice.payment_failed → paiement échoué ──
  if (type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const subId = invoice.subscription;
    const slug = await findSlugBySubscription(subId, invoice.metadata || {}, env);
    if (slug) {
      const { prospect, sha } = await getProspectFromGitHub(slug, env);
      prospect.payment_failed_at = new Date().toISOString();
      await commitProspectToGitHub(slug, prospect, sha, env);
    }
    return jsonResponse({ status: 'noted' });
  }

  return jsonResponse({ status: 'ignored', type });
}

/* ── Stripe signature verification (HMAC-SHA256) ── */

async function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    const parts = {};
    sigHeader.split(',').forEach(item => {
      const [key, val] = item.split('=');
      parts[key] = val;
    });

    const timestamp = parts['t'];
    const signature = parts['v1'];
    if (!timestamp || !signature) return false;

    // Tolérance de 5 minutes
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
    if (age > 300) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    return expected === signature;
  } catch {
    return false;
  }
}

/* ── Helper: trouver un slug par subscription ID ── */

async function findSlugBySubscription(subId, metadata, env) {
  // 1. Metadata du webhook (si on a passé le slug dans Stripe)
  if (metadata && metadata.slug) return metadata.slug;

  // 2. Recherche dans les prospects récents (derniers fichiers modifiés)
  // On cherche dans les prospects qui ont un stripe_subscription_id correspondant
  const listUrl = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/prospects`;
  const res = await githubFetch(listUrl, env);
  if (!res.ok) return null;

  const files = await res.json();
  // Limiter la recherche aux 100 derniers fichiers pour perf
  const recentFiles = files.slice(-100);

  for (const file of recentFiles) {
    if (!file.name.endsWith('.json')) continue;
    try {
      const slug = file.name.replace('.json', '');
      const { prospect } = await getProspectFromGitHub(slug, env);
      if (prospect.stripe_subscription_id === subId) return slug;
    } catch { continue; }
  }

  return null;
}

/* ═══════════════════════════════════════════════════════
   BREVO — Emails transactionnels
═══════════════════════════════════════════════════════ */

const BREVO_API = 'https://api.brevo.com/v3';

async function sendBrevoEmail(env, { to, toName, subject, html }) {
  if (!env.BREVO_API_KEY) {
    console.warn('BREVO_API_KEY non configurée, email ignoré');
    return;
  }

  const res = await fetch(`${BREVO_API}/smtp/email`, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Solia', email: 'contact@solia.me' },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Brevo email error:', err);
  }
}

/* ── Séquence emails (J1 = bienvenue, J3 = relance, J6 = urgence) ──
   J1 est envoyé dans handleStripeWebhook (checkout.session.completed)
   et handlePersonalize (nouveau prospect organique).
   J3 et J6 sont déclenchés par un Cron Trigger Cloudflare (voir scheduledHandler). */

async function sendTrialSequenceEmail(env, prospect, dayNumber) {
  if (!prospect.email) return;

  const name = [prospect.prenom, prospect.nom].filter(Boolean).join(' ');
  const pageUrl = `https://${prospect.slug}.solia.me`;
  const formUrl = `https://solia.me/formulaire/?prospect=${prospect.slug}`;

  let subject, html;

  if (dayNumber === 1) {
    subject = `${prospect.prenom || 'Bonjour'}, votre page pro est prête !`;
    html = `
      <div style="font-family:'DM Sans',Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <h1 style="font-family:Georgia,serif;font-size:1.5rem;color:#1A1A18;margin-bottom:16px">Bienvenue sur Solia ✨</h1>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Bonjour ${prospect.prenom || ''},</p>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Votre page vitrine est en ligne et prête à recevoir vos futurs clients :</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${pageUrl}" style="display:inline-block;background:#C4704F;color:#fff;font-weight:600;padding:14px 32px;border-radius:100px;text-decoration:none">Voir ma page →</a>
        </p>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Vous avez <strong>7 jours d'essai gratuit</strong> pour la personnaliser à votre image. Modifiez vos textes, ajoutez votre photo, choisissez votre thème.</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${formUrl}" style="display:inline-block;background:#fff;color:#C4704F;border:2px solid #C4704F;font-weight:600;padding:12px 28px;border-radius:100px;text-decoration:none">Personnaliser →</a>
        </p>
        <p style="color:#8A8074;font-size:0.85rem;margin-top:32px;border-top:1px solid #E4DDD4;padding-top:16px">L'équipe Solia<br><span style="font-family:Georgia,serif;font-style:italic;color:#1A1A18">Solia</span> — Votre vitrine bien-être</p>
      </div>`;
  } else if (dayNumber === 3) {
    subject = `${prospect.prenom || 'Bonjour'}, plus que 4 jours pour votre page`;
    html = `
      <div style="font-family:'DM Sans',Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <h1 style="font-family:Georgia,serif;font-size:1.5rem;color:#1A1A18;margin-bottom:16px">Votre essai continue 🕐</h1>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Bonjour ${prospect.prenom || ''},</p>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Il vous reste <strong>4 jours</strong> pour profiter de votre essai gratuit Solia. Avez-vous déjà personnalisé votre page ?</p>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Vos confrères qui personnalisent leur page reçoivent en moyenne <strong>3× plus de demandes de rendez-vous</strong>.</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${formUrl}" style="display:inline-block;background:#C4704F;color:#fff;font-weight:600;padding:14px 32px;border-radius:100px;text-decoration:none">Personnaliser ma page →</a>
        </p>
        <p style="text-align:center"><a href="${pageUrl}" style="color:#C4704F;font-size:0.9rem">Voir ma page actuelle →</a></p>
        <p style="color:#8A8074;font-size:0.85rem;margin-top:32px;border-top:1px solid #E4DDD4;padding-top:16px">L'équipe Solia</p>
      </div>`;
  } else if (dayNumber === 6) {
    subject = `⚠️ ${prospect.prenom || 'Attention'}, votre page expire demain`;
    html = `
      <div style="font-family:'DM Sans',Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <h1 style="font-family:Georgia,serif;font-size:1.5rem;color:#1A1A18;margin-bottom:16px">Dernière chance ⏳</h1>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Bonjour ${prospect.prenom || ''},</p>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Votre essai gratuit Solia expire <strong>demain</strong>. Après expiration, votre page ne sera plus accessible.</p>
        <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Pour la garder en ligne et continuer à recevoir des clients, publiez-la maintenant :</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${pageUrl}" style="display:inline-block;background:#C4704F;color:#fff;font-weight:600;padding:14px 32px;border-radius:100px;text-decoration:none">Publier ma page →</a>
        </p>
        <p style="color:#8A8074;font-size:0.85rem;line-height:1.6">Si vous ne souhaitez pas continuer, votre page sera simplement désactivée. Aucun engagement, aucun frais.</p>
        <p style="color:#8A8074;font-size:0.85rem;margin-top:32px;border-top:1px solid #E4DDD4;padding-top:16px">L'équipe Solia</p>
      </div>`;
  }

  if (subject && html) {
    await sendBrevoEmail(env, {
      to: prospect.email,
      toName: name,
      subject,
      html,
    });
  }
}

/* ── Emails de bienvenue et résiliation ── */

function buildWelcomeEmail(prospect) {
  const name = [prospect.prenom, prospect.nom].filter(Boolean).join(' ');
  const pageUrl = `https://${prospect.slug}.solia.me`;
  const editUrl = `https://solia.me/formulaire/?prospect=${prospect.slug}` +
    (prospect.edit_token ? `&token=${prospect.edit_token}` : '');

  return `
    <div style="font-family:'DM Sans',Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <h1 style="font-family:Georgia,serif;font-size:1.5rem;color:#1A1A18;margin-bottom:16px">Votre page est publiée ! 🎉</h1>
      <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Bonjour ${prospect.prenom || ''},</p>
      <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Merci pour votre confiance ! Votre page pro est désormais en ligne de façon permanente :</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${pageUrl}" style="display:inline-block;background:#C4704F;color:#fff;font-weight:600;padding:14px 32px;border-radius:100px;text-decoration:none">${prospect.slug}.solia.me</a>
      </p>
      <p style="color:#4A4A4A;line-height:1.6;margin-bottom:8px"><strong>Modifier votre page :</strong></p>
      <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Vous pouvez à tout moment mettre à jour vos informations grâce à ce lien personnel :</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${editUrl}" style="display:inline-block;background:#fff;color:#C4704F;border:2px solid #C4704F;font-weight:600;padding:12px 28px;border-radius:100px;text-decoration:none">Modifier ma page →</a>
      </p>
      <p style="color:#8A8074;font-size:0.82rem;line-height:1.5">⚠️ Conservez ce lien, il est personnel et permet de modifier votre page.</p>
      <p style="color:#8A8074;font-size:0.85rem;margin-top:32px;border-top:1px solid #E4DDD4;padding-top:16px">L'équipe Solia<br><span style="font-family:Georgia,serif;font-style:italic;color:#1A1A18">Solia</span></p>
    </div>`;
}

function buildCancellationEmail(prospect) {
  return `
    <div style="font-family:'DM Sans',Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <h1 style="font-family:Georgia,serif;font-size:1.5rem;color:#1A1A18;margin-bottom:16px">Votre page a été désactivée</h1>
      <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Bonjour ${prospect.prenom || ''},</p>
      <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Suite à la résiliation de votre abonnement, votre page <strong>${prospect.slug}.solia.me</strong> a été désactivée.</p>
      <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Vos données sont conservées. Si vous souhaitez réactiver votre page, il suffit de nous contacter.</p>
      <p style="color:#4A4A4A;line-height:1.6;margin-bottom:16px">Merci d'avoir utilisé Solia, et à bientôt peut-être !</p>
      <p style="color:#8A8074;font-size:0.85rem;margin-top:32px;border-top:1px solid #E4DDD4;padding-top:16px">L'équipe Solia</p>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   CRON — Séquence emails J1/J3/J6 (Cloudflare Scheduled)
═══════════════════════════════════════════════════════ */

async function scheduledHandler(env) {
  if (!env.BREVO_API_KEY) return;

  // Lister tous les prospects
  const listUrl = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/prospects`;
  const res = await githubFetch(listUrl, env);
  if (!res.ok) return;

  const files = await res.json();
  const now = Date.now();

  for (const file of files) {
    if (!file.name.endsWith('.json')) continue;
    try {
      const slug = file.name.replace('.json', '');
      const { prospect } = await getProspectFromGitHub(slug, env);

      // Ne traiter que les prospects en essai (page active, non publiés, avec email)
      if (!prospect.page_active || prospect.published || prospect.paid || !prospect.email) continue;
      if (!prospect.demo_created_at) continue;

      const created = new Date(prospect.demo_created_at).getTime();
      const daysSinceCreation = Math.floor((now - created) / 86400000);

      // Vérifier si l'email a déjà été envoyé (via un champ emails_sent)
      const sent = prospect.emails_sent || [];

      if (daysSinceCreation >= 1 && daysSinceCreation < 3 && !sent.includes('j1')) {
        await sendTrialSequenceEmail(env, prospect, 1);
        prospect.emails_sent = [...sent, 'j1'];
        const { sha } = await getProspectFromGitHub(slug, env);
        await commitProspectToGitHub(slug, prospect, sha, env);
      } else if (daysSinceCreation >= 3 && daysSinceCreation < 6 && !sent.includes('j3')) {
        await sendTrialSequenceEmail(env, prospect, 3);
        prospect.emails_sent = [...sent, 'j3'];
        const { sha } = await getProspectFromGitHub(slug, env);
        await commitProspectToGitHub(slug, prospect, sha, env);
      } else if (daysSinceCreation >= 6 && !sent.includes('j6')) {
        await sendTrialSequenceEmail(env, prospect, 6);
        prospect.emails_sent = [...sent, 'j6'];
        const { sha } = await getProspectFromGitHub(slug, env);
        await commitProspectToGitHub(slug, prospect, sha, env);
      }
    } catch (err) {
      console.error(`Cron email error for ${file.name}:`, err);
    }
  }
}

/* ═══════════════════════════════════════════════════════
   UTILITAIRES
═══════════════════════════════════════════════════════ */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function parseLines(str) {
  if (!str) return [];
  return str.split('\n').map(s => s.trim()).filter(Boolean);
}

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
