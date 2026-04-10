/**
 * Cloudflare Worker — solia-enrichment.js
 *
 * Routes :
 *   POST /api/personalize       → Enrichit le JSON via Claude, commit sur GitHub, trigger rebuild
 *   POST /api/toggle-page       → Met en ligne / hors ligne une page démo prospect
 *   POST /api/import            → Import bulk de prospects (depuis CSV dashboard)
 *   GET  /api/status/:slug      → Vérifie si la page a été reconstruite récemment
 *   GET  /api/prospect/:slug    → Retourne les données de base du prospect (pré-remplissage form)
 *
 * Variables d'environnement (Cloudflare Secrets) :
 *   ANTHROPIC_API_KEY   → à brancher quand disponible
 *   GITHUB_TOKEN        → Personal Access Token, scope: repo
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

      // POST /api/import
      if (request.method === 'POST' && path === '/api/import') {
        return await handleImport(request, env);
      }

      // GET /api/status/:slug
      if (request.method === 'GET' && path.startsWith('/api/status/')) {
        const slug = path.replace('/api/status/', '').replace(/\/$/, '');
        return await handleStatus(slug, env);
      }

      // GET /api/prospect/:slug
      if (request.method === 'GET' && path.startsWith('/api/prospect/')) {
        const slug = path.replace('/api/prospect/', '').replace(/\/$/, '');
        return await handleProspect(slug, env);
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

  // 1. Récupérer le JSON prospect depuis GitHub
  const { prospect, sha } = await getProspectFromGitHub(slug, env);

  // 2. Enrichir via Claude (placeholder tant que la clé n'est pas branchée)
  const enriched = await enrichWithClaude(body, prospect, env);

  // 3. Fusionner les données dans le prospect
  const updated = mergeProspect(prospect, body, enriched);

  // 4. Committer le JSON mis à jour sur GitHub
  await commitProspectToGitHub(slug, updated, sha, env);

  // 5. Committer les photos si présentes
  if (body.photo_profil) {
    await commitImageToGitHub(slug, 'profil.jpg', body.photo_profil, env);
    updated.photo_url = `https://soliapro.github.io/solia/${slug}/img/profil.jpg`;
  }
  if (body.photos_cabinet?.length) {
    for (let i = 0; i < Math.min(body.photos_cabinet.length, 5); i++) {
      await commitImageToGitHub(slug, `cabinet-${i + 1}.jpg`, body.photos_cabinet[i], env);
    }
  }

  // 6. Trigger le rebuild GitHub Actions
  await triggerRebuild(slug, env);

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

async function handleProspect(slug, env) {
  let prospect, sha;
  try {
    ({ prospect, sha } = await getProspectFromGitHub(slug, env));
  } catch (err) {
    return jsonResponse({ error: `Prospect introuvable : ${slug}` }, 404);
  }

  // Ne retourner que les champs utiles pour le pré-remplissage
  const safe = {
    slug:              prospect.slug,
    prenom:            prospect.prenom            || '',
    nom:               prospect.nom               || '',
    metier:            prospect.metier            || '',
    ville:             prospect.ville             || '',
    telephone:         prospect.telephone         || '',
    adresse:           prospect.adresse           || '',
    horaires:          prospect.horaires          || '',
    tarif:             prospect.tarif             || '',
    duree_seance:      prospect.duree_seance      || '',
    photo_url:         prospect.photo_url         || '',
    avis_google_note:  prospect.avis_google_note  ?? null,
    avis_google_nb:    prospect.avis_google_nb    ?? null,
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
  return {
    ...prospect,
    // Infos de base (formulaire prioritaire)
    prenom:       formData.prenom       || prospect.prenom    || '',
    nom:          formData.nom          || prospect.nom       || '',
    metier:       formData.metier       || prospect.metier    || '',
    ville:        formData.ville        || prospect.ville     || '',
    telephone:    formData.telephone    || prospect.telephone || '',
    email:        formData.email        || prospect.email     || '',
    // Contenu enrichi par Claude (ou placeholder)
    description:  enriched.description  || prospect.description  || '',
    approche:     enriched.approche     || prospect.approche     || '',
    specialites:  enriched.specialites?.length
                    ? enriched.specialites
                    : prospect.specialites || [],
    horaires:     enriched.horaires     || formData.horaires  || prospect.horaires || '',
    tarif:        formData.tarif        || prospect.tarif     || '',
    duree_seance: formData.duree_seance || prospect.duree_seance || '',
    // Flags
    email_confirme: prospect.email_confirme || false,
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
  const content = atob(data.content.replace(/\n/g, ''));
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
    body: JSON.stringify({
      message: `feat(prospect): mise à jour ${slug} depuis formulaire`,
      content,
      sha,
    }),
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
    // ── METTRE EN LIGNE : générer une page démo et la committer ──
    const { prospect } = await getProspectFromGitHub(slug, env);
    const html = buildDemoPage(prospect);
    await commitFileToGitHub(`demos/${slug}/index.html`, html, `feat: page démo ${slug}`, env);
    return jsonResponse({ status: 'online', slug });
  } else {
    // ── HORS LIGNE : supprimer la page ──
    await deleteFileFromGitHub(`demos/${slug}/index.html`, `feat: retrait page ${slug}`, env);
    return jsonResponse({ status: 'offline', slug });
  }
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
      notes:          '',
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
    <a href="${formUrl}" class="banner-btn">Activer ma page &rarr;</a>
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
        Activer ma page &rarr;
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
