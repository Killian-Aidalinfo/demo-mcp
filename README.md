# demo-mcp

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Dashboard Salaires & offres IT (France Travail)

Prérequis : `.env` avec `FT_CLIENT_ID` et `FT_CLIENT_SECRET` (appli abonnée aux APIs
« Offres d'emploi v2 » et « Marché du travail »).

```bash
bun fetch-data.ts            # construit le cache SQLite (data.sqlite) + dashboard-data.js
bun fetch-data.ts --refresh  # force la ré-interrogation des APIs (ignore le cache)
```

Puis ouvrir **`index.html`** dans un navigateur (double-clic, aucun serveur requis).

Contenu :
- Carte de France métropolitaine par région, coloriée selon l'indicateur choisi.
- Filtres : salaire (débutant/moyen/expérimenté) **ou** nombre d'offres 2026 (tous / Bac+3 / Bac+5),
  par métier (Développeur, DevOps, Administrateur systèmes).
- Comparaison des 3 métiers (salaires + offres) au national ou pour la région sélectionnée.
- Tableau détaillé triable par région.

`fetch-data.ts` met chaque réponse d'API en cache dans `data.sqlite` : les relances sont instantanées.
`index.ts` reste la démo d'appels brute aux deux APIs.
