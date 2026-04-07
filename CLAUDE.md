# Solia — Guide de développement

## Ce qu'est Solia

Un outil qui génère des pages pro pour praticiens bien-être indépendants
à partir d'un fichier JSON. Une page = un praticien.

---

## Structure du projet

```
/
├── CLAUDE.md                 ← ce fichier
├── prospects/
│   └── exemple.json          ← 1 prospect fictif complet (pour tester)
├── templates/
│   ├── wellness-page.html    ← template HTML (CSS embarqué, zéro dépendance)
│   └── schema.json           ← schema de référence documenté
├── demos/                    ← peuplé automatiquement par le script
├── scripts/
│   ├── generate-pages.js     ← pipeline JSON → HTML
│   └── validate-json.js      ← validation du JSON avant génération
└── REPORT.md                 ← généré automatiquement
```

---

## Usage

### Générer les pages

```bash
node scripts/generate-pages.js prospects/exemple.json
```

Pour écraser les pages existantes :
```bash
node scripts/generate-pages.js prospects/exemple.json --force
```

### Valider un fichier JSON

```bash
node scripts/validate-json.js prospects/exemple.json
```

---

## Règles de génération

1. Seuls les prospects avec `email_confirme: true` sont générés.
2. Les pages sont créées dans `demos/[slug]/index.html`.
3. Une page existante n'est jamais écrasée sans `--force`.
4. Le `REPORT.md` est mis à jour après chaque génération.

---

## Thèmes

| Valeur | Métiers par défaut | Ambiance |
|--------|-------------------|----------|
| `zen` | yoga, massage, méditation, reiki, shiatsu | épuré, doux |
| `nature` | naturopathie, diététique, nutrition, herboristerie | verts, organique |
| `lumiere` | tous les autres | chaud, lumineux |

Si `theme` absent → attribué automatiquement selon le métier.

---

## Fallbacks

| Champ absent | Comportement |
|---|---|
| `photo_url` | Initiales CSS depuis `prenom` + `nom` |
| `theme` | Auto selon métier |
| `avis_google_*` | Section masquée |
| `horaires` | "Sur rendez-vous — contactez-moi" |
| `tarif` | "Tarifs sur demande" |
| `approche` | Section masquée |
| `specialites` | Section masquée |

---

## Ajouter un nouveau prospect

1. Créer un fichier dans `prospects/` (ou ajouter un objet dans un fichier JSON existant)
2. Remplir les champs obligatoires (voir `templates/schema.json`)
3. Mettre `email_confirme: true`
4. Lancer `node scripts/generate-pages.js prospects/[fichier].json`
