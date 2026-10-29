# Serveur MCP France Travail

Serveur [MCP](https://modelcontextprotocol.io) (transport stdio ou HTTP) qui expose les APIs
**France Travail** (Offres d'emploi v2, Marché du travail, La Bonne Boîte v2, ROMEO v2,
ROME 4.0 Métiers / Fiches métiers / Compétences) et **La bonne alternance** (offres et
formations en alternance) sous forme de tools, plus des tools « assistants » qui aident un
modèle à construire des requêtes valides (localisation, codes INSEE, ROME, territoires).

## Structure

```
mcp/
├── index.ts              # point d'entrée : crée le serveur + connecte stdio
├── client/               # couche d'accès aux APIs (testable, sans MCP)
│   ├── auth.ts           # OAuth2 client_credentials + cache de token par scope
│   ├── ft-api.ts         # appel générique d'une API partenaire (token, quota, relance 429)
│   ├── rate-limit.ts     # RateLimiter (quota par API) + mapAvecConcurrence
│   ├── pagination.ts     # calcul des pages (range, plafond d'index)
│   ├── offres.ts         # API Offres d'emploi v2 + référentiels
│   ├── stats.ts          # API Marché du travail (stats par territoire, salaires)
│   ├── labonneboite.ts   # API La Bonne Boîte v2 (entreprises à potentiel d'embauche)
│   ├── romeo.ts          # API ROMEO v2 (texte libre → métier / compétence ROME)
│   ├── rome.ts           # APIs ROME 4.0 Métiers, Fiches métiers, Compétences
│   ├── alternance.ts     # API La bonne alternance (offres, recruteurs, formations)
│   ├── geo.ts            # geo.api.gouv.fr : commune → code INSEE + coordonnées GPS
│   └── recherche-alternances.ts  # recherche multi-sources + dédoublonnage
└── tools/                # adaptateurs MCP (enregistrement des tools)
    ├── index.ts          # enregistrerTousLesTools()
    ├── offres.ts         # rechercher_offres, consulter_offre
    ├── stats.ts          # statistiques_marche, decouvrir_indicateurs, salaires_metier
    ├── referentiels.ts   # localiser_commune, chercher_code_insee, lister_referentiel, lister_territoires_stats
    ├── alternance.ts     # rechercher_offres_alternance, consulter_offre_alternance, rechercher_formations_alternance
    ├── recherche.ts      # rechercher_alternances
    ├── entreprises.ts    # entreprises_qui_recrutent
    └── metiers.ts        # identifier_metier, rechercher_metier, fiche_metier, consulter_competence
```

Les fichiers `*.test.ts` (à côté du code testé) couvrent la logique pure et les
appels réseau via un `fetch` mocké.

## Tools exposés

| Tool | Source | Rôle |
|------|--------|------|
| `rechercher_alternances` | FT + LBA + LBB | **Point d'entrée alternance** : ville + rayon + ROME → offres des deux sources fusionnées, dédoublonnées, plus récentes d'abord. Avec `inclureRecruteurs`, ajoute les entreprises à potentiel d'embauche (La Bonne Boîte + LBA, dédoublonnées par SIRET). Une source en panne n'empêche pas les autres. |
| `entreprises_qui_recrutent` | FT (La Bonne Boîte) | Entreprises à fort potentiel d'embauche pour des métiers ROME autour d'une ville, même sans offre publiée : candidatures spontanées. |
| `identifier_metier` | FT (ROMEO) | Texte libre (« admin sys et réseau ») → codes ROME avec score de confiance ; `type: competence` pour une compétence. |
| `rechercher_metier` | FT (ROME 4.0) | Recherche plein texte dans les métiers ou les appellations (intitulés de poste). |
| `fiche_metier` | FT (ROME 4.0) | Définition, accès à l'emploi, intitulés, compétences par enjeu, savoirs, contextes de travail d'un métier. |
| `consulter_competence` | FT (ROME 4.0) | Détail d'une compétence ou d'un savoir par code OGR. |
| `salaires_metier` | FT (Marché du travail) | Salaires mensuels en poste d'un métier ROME par territoire (moins de 35 ans, 35 ans et plus, tous âges). |
| `rechercher_offres` | FT | Recherche d'offres (mots-clés, INSEE, ROME, contrat, `alternance`, niveau, expérience…), pagination auto, résultats résumés. |
| `consulter_offre` | FT | Détail complet d'une offre par identifiant. |
| `rechercher_offres_alternance` | LBA | Offres d'alternance autour de coordonnées GPS (rayon, niveau de diplôme, ROME, RNCP, départements) + entreprises susceptibles de recruter. |
| `consulter_offre_alternance` | LBA | Détail d'une offre La bonne alternance (compétences, conditions d'accès…). |
| `rechercher_formations_alternance` | LBA | Formations en apprentissage autour d'un point (CFA, diplôme, RNCP, contact). |
| `statistiques_marche` | FT | Indicateurs du marché du travail par territoire (offres, demandeurs, embauches, tension…). |
| `decouvrir_indicateurs` | FT | Combinaisons valides (indicateur × activité × nomenclature × période). |
| `localiser_commune` | geo.api.gouv.fr | **Assistant** : nom / code postal / INSEE → code INSEE, département, latitude/longitude. Sans clé. |
| `chercher_code_insee` | FT | **Assistant** : nom → code dans un référentiel FT (commune, département, ROME, appellation…). |
| `lister_referentiel` | FT | **Assistant** : référentiel complet de l'API Offres (naturesContrats, niveauxFormations…). |
| `lister_territoires_stats` | FT | **Assistant** : territoires + codes pour l'API Marché du travail (REG, DEP…). |

> Flux type pour le modèle : `identifier_metier` (« admin sys et réseau ») pour les codes ROME,
> puis `rechercher_alternances` (« Nancy », 30 km, M1801,M1830, `inclureRecruteurs`) et le tool
> de détail indiqué pour chaque offre ; `fiche_metier` pour préparer un CV ; `localiser_commune` puis `rechercher_offres`
> pour l'emploi classique ; `lister_territoires_stats` (REG → 84) puis `statistiques_marche`.

## Configuration

Chaque source est optionnelle : sans ses identifiants, ses tools renvoient une erreur
explicite et `rechercher_alternances` continue avec l'autre source.

- **France Travail** : créer une application sur [francetravail.io](https://francetravail.io)
  et l'abonner aux APIs utilisées : *Offres d'emploi v2*, *Marché du travail*, *La Bonne Boite v2*,
  *ROMEO v2*, *ROME 4.0 - Métiers*, *ROME 4.0 – Fiches métiers*, *ROME 4.0 - Compétences*. Une API
  non souscrite ne bloque que ses tools (un jeton est demandé par scope).
- **La bonne alternance** : clé gratuite sur
  [api.apprentissage.beta.gouv.fr](https://api.apprentissage.beta.gouv.fr) (usage non lucratif,
  60 recherches/min).

Puis renseigner le `.env` à la racine du projet :

```
FT_CLIENT_ID=...
FT_CLIENT_SECRET=...
LBA_API_KEY=...
```

Bun charge automatiquement le `.env`.

## Utilisation (npx)

Le serveur est publié sur npm sous **`@ninapepite/mcp-france-travail`** (anciennement `cesi-mcp-france-travail`, figé en 0.1.0) et tourne sous Node
(≥ 18) — aucune installation de Bun n'est requise côté utilisateur. Pour le brancher sur
un client MCP (Claude Code, etc.), ajouter dans la config MCP du client :

```json
{
  "mcpServers": {
    "france-travail": {
      "command": "npx",
      "args": ["-y", "@ninapepite/mcp-france-travail"],
      "env": {
        "FT_CLIENT_ID": "...",
        "FT_CLIENT_SECRET": "...",
        "LBA_API_KEY": "..."
      }
    }
  }
}
```

> Sous `npx` il n'y a pas de `.env` : les identifiants se passent par le bloc `env`
> ci-dessus (le serveur lit `process.env.FT_CLIENT_ID` / `FT_CLIENT_SECRET` / `LBA_API_KEY`).

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
  début de page ≤ 3000, donc 3150 offres au plus par recherche (mesuré le 29/10/2026).
- **Marché du travail** — scope **double** obligatoire ; réponse XML par défaut (on force
  `Accept: application/json`) ; chaque indicateur impose une nomenclature précise
  (`stat-offres` → `ORIGINEOFF`) → utiliser `decouvrir_indicateurs` en cas de doute.
- **Alternance (FT)** — pas de filtre « alternance » unique : on interroge les natures de
  contrat `E2` (apprentissage) et `FS` (professionnalisation) puis on fusionne.
- **La Bonne Boîte** — scope à trois segments `api_labonneboitev2 search office` ; un code ROME
  (ou `job`) obligatoire ; une entreprise ressort une fois par code ROME demandé (on dédoublonne
  par SIRET) ; 2 appels/s.
- **ROME 4.0** — quota strict de 1 appel/s par API (on espace de 1,1 s et on relance une fois
  sur 429) ; le ROME 4.0 a affiné le numérique : M1830 (réseaux - télécoms), M1843 (serveurs),
  M1817 (sécurité) à côté de M1801 (administrateur SI).
- **Salaires** — l'indicateur SAL_3 se découpe par âge (SAL1 moins de 35 ans, SAL2 35 ans et
  plus, SAL3 tous âges) et par famille professionnelle (FAP) rattachée au code ROME.
- **La bonne alternance** — pas de total renvoyé ; les offres France Travail qu'elle
  republie n'ont pas d'`id` LBA (seulement un lien) ; `target_diploma_level` renvoie aussi
  les offres sans niveau précisé ; résultats plafonnés à 150 par source.
