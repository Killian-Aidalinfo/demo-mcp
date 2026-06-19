# API Marché du travail (Offre et demande)

Documentation : <https://francetravail.io/produits-partages/catalogue/marche-travail/documentation>

Fournit des **statistiques agrégées** pour analyser la situation de l'emploi sur un
territoire : volumes d'offres, de demandeurs, d'embauches, indicateurs de tension et
salaires. Données croisées **France Travail, ACOSS, CCMSA et DARES**, mises à jour
**trimestriellement**.

- **Base URL** : `https://api.francetravail.io/partenaire/...` (préfixe propre à l'API ; à confirmer dans le Swagger)
- **Scope OAuth2** : scope dédié « marché du travail » (à récupérer sur le portail)
- **Limite de débit** : ~10 appels/seconde
- **Format** : REST / JSON

> ⚠️ La page de documentation est une SPA Swagger non lisible automatiquement.
> Les **familles d'indicateurs ci-dessous sont confirmées** (sources data.gouv /
> api.gouv). Les **noms exacts de chemins et de paramètres** doivent être vérifiés
> dans le Swagger interactif avant intégration.

---

## Concepts communs

Les requêtes statistiques se paramètrent généralement par :

| Dimension | Description |
|-----------|-------------|
| **Maille géographique** | Niveau territorial : national, région, département, bassin d'emploi, commune… |
| **Code territoire** | Identifiant du territoire ciblé (INSEE / code bassin). |
| **Période** | Trimestre / année de référence. |
| **Nomenclature métier** | Code ROME, domaine, grand domaine. |
| **Secteur d'activité** | Code NAF / secteur. |
| **Compétence** | Filtrage par compétence. |

---

## Familles d'indicateurs exposées

| Indicateur | Utilité |
|------------|---------|
| **Offres d'emploi collectées** | Volume d'offres déposées par métier, secteur et compétence sur un territoire. |
| **Demandeurs d'emploi (DEFM)** | Nombre de demandeurs inscrits par métier et compétence (stock trimestriel). |
| **Entrées de demandeurs (DEE)** | Nouvelles inscriptions sur le trimestre et sur 12 mois glissants. |
| **Embauches / recrutements** | Volumes d'embauches par métier recherché et par secteur. |
| **Indicateur de dynamique d'emploi** | Évaluation globale de la situation de l'emploi sur un territoire. |
| **Difficultés de recrutement / tension** | Métiers, secteurs et compétences en tension (perspective de recrutement). |
| **Salaires proposés** | Salaires offerts par métier. |

Ces indicateurs alimentent notamment le portail [Data Emploi](https://dataemploi.francetravail.fr).

---

## Structure type des endpoints

L'API expose un endpoint par famille d'indicateur (un appel = un indicateur croisé
avec les dimensions souhaitées). Schéma général :

```
GET (ou POST) /partenaire/<api-marche-travail>/<indicateur>
  ?maille=<niveau>&codeTerritoire=<code>&periode=<trimestre>&codeNomenclature=<ROME/NAF>
```

Indicateurs attendus (à mapper sur les chemins exacts du Swagger) :

- offres collectées
- demandeurs d'emploi (stock)
- entrées de demandeurs (flux)
- embauches
- indicateur de tension
- indicateur de dynamique d'emploi
- salaires

> Pour obtenir la liste exacte des chemins, méthodes (GET/POST), schémas de requête
> et codes territoires acceptés, ouvrez le Swagger « Try it out » sur la page de
> documentation et authentifiez-vous avec votre token OAuth2.

---

## Cas d'usage typiques

- Tableau de bord territorial : comparer offres vs demandeurs par bassin d'emploi.
- Détection des métiers en tension sur une région.
- Analyse de l'évolution des embauches d'un secteur sur 12 mois.
- Benchmark salarial par métier et par territoire.
