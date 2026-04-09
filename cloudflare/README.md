# Cloudflare Worker — Solia

## Déploiement (une seule fois)

### 1. Dans Cloudflare Dashboard → Workers & Pages

- Clique **Create Worker**
- Remplace le code par le contenu de `worker.js`
- Clique **Deploy**
- Note le nom du worker (ex: `solia-worker`)

### 2. DNS — ajouter le wildcard

Dans Cloudflare → DNS → Add record :

| Type  | Name | Content         | Proxy |
|-------|------|-----------------|-------|
| A     | @    | 192.0.2.1       | ✅ Proxied |
| CNAME | *    | solia.me        | ✅ Proxied |

> Le `192.0.2.1` est une IP factice — le Worker intercepte avant que le trafic n'arrive.

### 3. Route du Worker

Dans le Worker → Settings → Triggers → Add route :
```
*.solia.me/*
```
Zone : `solia.me`

Et aussi :
```
solia.me/*
```

### 4. GitHub Pages — mettre à jour le CNAME

Le fichier `demos/CNAME` contient déjà `solia.me`.
Dans GitHub → Settings → Pages : vérifier que le domaine custom est bien `solia.me`.
