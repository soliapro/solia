/**
 * Cloudflare Worker — solia-enrichment.js
 *
 * Routes :
 *   POST /api/personalize       → Enrichit le JSON via Claude, commit sur GitHub, trigger rebuild
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
