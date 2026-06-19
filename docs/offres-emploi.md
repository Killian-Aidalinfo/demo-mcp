# API Offres d'emploi v2

Documentation : <https://francetravail.io/produits-partages/catalogue/offres-emploi/documentation>

Permet de **rechercher** et **consulter** les offres d'emploi diffusées en temps réel par France Travail et ses partenaires (offres actives uniquement).

- **Base URL** : `https://api.francetravail.io/partenaire/offresdemploi/v2`
- **Scope OAuth2** : `api_offresdemploiv2 o2dsoffre`
- **Limite de débit** : ~10 appels/seconde
- **Format** : REST / JSON

---

## Endpoints

### 1. `GET /offres/search`
Recherche d'offres selon des critères de sélection, avec résultats paginés.

- **Réponse** :
  - `resultats` : liste détaillée des offres correspondant aux critères.
  - `filtresPossibles` : agrégats (compteurs) par valeur de filtre (utile pour des facettes).
- **Pagination** : via le paramètre `range` (`début-fin`, ex. `0-149`).
  - 150 offres max par appel ; **1150 offres max** au total (`range` jusqu'à `1000-1149`).
  - L'en-tête de réponse `Content-Range` renvoie ex. `offres 0-149/287543` (total disponible).
- **Codes HTTP** : `200` (résultats complets), `206` (résultats partiels/paginés), `204` (aucun résultat).

**Principaux paramètres de recherche** (query string) :

| Paramètre | Utilité |
|-----------|---------|
| `motsCles` | Mots-clés (intitulé, compétences…) |
| `commune` / `departement` / `region` | Localisation (codes INSEE) |
| `distance` | Rayon en km autour de la commune |
| `codeROME` | Filtrer par code métier ROME |
| `typeContrat` | CDI, CDD, MIS… |
| `natureContrat` | Nature du contrat (référentiel) |
| `experience` | Niveau d'expérience exigé |
| `qualification` | Cadre / non-cadre |
| `tempsPlein` | `true`/`false` |
| `salaireMin` | Salaire minimum |
| `dateCreation` / `dateModification` | Bornes temporelles (min-max) |
| `publieeDepuis` | Offres publiées depuis N jours (1, 3, 7, 14, 31) |
| `partenaires` / `origineOffre` | Source de l'offre (France Travail / partenaires) |
| `range` | Pagination |
| `sort` | Tri des résultats |

### 2. `GET /offres/{id}`
Consulte le détail complet d'une offre (intitulé, description, lieu, entreprise, type de contrat, salaire, compétences, contact…).

- **Paramètre de chemin** : `id` = identifiant de l'offre.
- **Codes HTTP** : `200` (offre trouvée), `204` (pas de contenu), `400`, `404`.

### 3. `GET /referentiel/{referentiel}`
Renvoie les données de référence utilisées par l'API (pour construire/valider les filtres de recherche).

- **Paramètre de chemin** : `referentiel` = nom du référentiel souhaité.

**Référentiels disponibles (exemples)** :

| Référentiel | Contenu |
|-------------|---------|
| `communes` | Communes (codes INSEE) |
| `departements` | Départements |
| `regions` | Régions |
| `pays` | Pays |
| `continents` | Continents |
| `naturesContrats` | Natures de contrat |
| `typesContrats` | Types de contrat |
| `niveauxFormations` | Niveaux de formation |
| `permis` | Permis de conduire |
| `langues` | Langues |
| `domaines` | Domaines professionnels |
| `appellations` | Appellations métiers (ROME) |
| `metiers` | Métiers |
| `themes` | Thèmes |
| `secteursActivites` | Secteurs d'activité (NAF) |

---

## Exemple

```bash
# Recherche : offres de "développeur" à Paris dans un rayon de 20 km
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?motsCles=developpeur&commune=75056&distance=20&range=0-49"

# Détail d'une offre
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/187XYZK"

# Référentiel des types de contrat
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.francetravail.io/partenaire/offresdemploi/v2/referentiel/typesContrats"
```
