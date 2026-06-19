# Serveur MCP France Travail

Serveur [MCP](https://modelcontextprotocol.io) (transport stdio) qui expose les APIs
**France Travail** (Offres d'emploi v2 & Marché du travail) sous forme de tools, plus
des tools « assistants » qui aident un modèle à construire des requêtes valides
(codes INSEE, ROME, territoires).

## Structure

```
mcp/
├── index.ts              # point d'entrée : crée le serveur + connecte stdio
├── client/               # couche d'accès aux APIs (testable, sans MCP)
│   ├── auth.ts           # OAuth2 client_credentials + cache de token par scope
│   ├── rate-limit.ts     # RateLimiter (10 req/s) + mapAvecConcurrence
│   ├── pagination.ts     # calcul des pages (range, plafond d'index)
│   ├── offres.ts         # API Offres d'emploi v2 + référentiels
│   └── stats.ts          # API Marché du travail (stats par territoire)
└── tools/                # adaptateurs MCP (enregistrement des tools)
    ├── index.ts          # enregistrerTousLesTools()
    ├── offres.ts         # rechercher_offres, consulter_offre
    ├── stats.ts          # statistiques_marche, decouvrir_indicateurs
    └── referentiels.ts   # chercher_code_insee, lister_referentiel, lister_territoires_stats
```

Les fichiers `*.test.ts` (à côté du code testé) couvrent la logique pure et les
appels réseau via un `fetch` mocké.

## Tools exposés

| Tool | Rôle |
|------|------|
| `rechercher_offres` | Recherche d'offres (mots-clés, localisation INSEE, ROME, contrat…), pagination auto. |
| `consulter_offre` | Détail complet d'une offre par identifiant. |
| `statistiques_marche` | Indicateurs du marché du travail par territoire (offres, demandeurs, embauches, tension…). |
| `decouvrir_indicateurs` | Combinaisons valides (indicateur × activité × nomenclature × période). |
| `chercher_code_insee` | **Assistant** : nom → code (commune INSEE, département, région, ROME…). |
| `lister_referentiel` | **Assistant** : référentiel complet de l'API Offres (typesContrats, regions…). |
| `lister_territoires_stats` | **Assistant** : territoires + codes pour l'API Marché du travail (REG, DEP…). |

> Flux type pour le modèle : `chercher_code_insee` (« Lyon » → 69381) puis
> `rechercher_offres`, ou `lister_territoires_stats` (REG → 84) puis `statistiques_marche`.

## Configuration

Créer une application sur [francetravail.io](https://francetravail.io), s'abonner aux
deux APIs, puis renseigner le `.env` à la racine du projet :

```
FT_CLIENT_ID=...
FT_CLIENT_SECRET=...
```

Bun charge automatiquement le `.env`.

## Utilisation (npx)

Le serveur est publié sur npm sous **`cesi-mcp-france-travail`** et tourne sous Node
(≥ 18) — aucune installation de Bun n'est requise côté utilisateur. Pour le brancher sur
un client MCP (Claude Code, etc.), ajouter dans la config MCP du client :

```json
{
  "mcpServers": {
    "france-travail": {
      "command": "npx",
      "args": ["-y", "cesi-mcp-france-travail"],
      "env": {
        "FT_CLIENT_ID": "...",
        "FT_CLIENT_SECRET": "..."
      }
    }
  }
}
```

> Sous `npx` il n'y a pas de `.env` : les identifiants se passent par le bloc `env`
> ci-dessus (le serveur lit `process.env.FT_CLIENT_ID` / `FT_CLIENT_SECRET`).

## Développement local

```bash
bun run mcp        # démarre le serveur MCP (stdio) depuis les sources
bun test           # tests unitaires
bun run build      # bundle Node -> dist/index.js (shebang + bin)
```

## Build & publication

- `bun run build` produit un bundle Node unique `dist/index.js` (cible `node`, deps
  `@modelcontextprotocol/sdk` et `zod` laissées externes, résolues à l'install).
- La publication npm est **automatique** : le workflow GitHub Actions
  `.github/workflows/publish-mcp.yml` se déclenche sur push `main` touchant `mcp/`,
  compare la version du `package.json` à celle publiée sur npm, et ne publie que si
  elle est nouvelle (secret repo `NPM_TOKEN` requis). **Pour publier : bumper la version
  dans `mcp/package.json` et pousser sur `main`.**

## Pièges connus (cf. `../docs/`)

- **Offres** — `commune` = code INSEE *connu du référentiel* ; Lyon global `69123` est
  refusé (utiliser les arrondissements `69381..69389`). Pagination `range`, max 150/page,
  plafond d'index ~3150.
- **Marché du travail** — scope **double** obligatoire ; réponse XML par défaut (on force
  `Accept: application/json`) ; chaque indicateur impose une nomenclature précise
  (`stat-offres` → `ORIGINEOFF`) → utiliser `decouvrir_indicateurs` en cas de doute.
