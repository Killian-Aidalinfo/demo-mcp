# APIs France Travail — Documentation des endpoints

Ce dossier documente deux APIs du catalogue [francetravail.io](https://francetravail.io) :

| API | Fichier | Utilité |
|-----|---------|---------|
| **Offres d'emploi v2** | [offres-emploi.md](./offres-emploi.md) | Rechercher et consulter les offres d'emploi diffusées par France Travail et ses partenaires (temps réel). |
| **Marché du travail** | [marche-travail.md](./marche-travail.md) | Statistiques agrégées sur l'offre et la demande d'emploi par territoire (offres, demandeurs, embauches, tension, salaires). |

## Authentification (commune aux deux APIs)

Toutes les APIs France Travail sont des **REST / JSON** sécurisées en **OAuth2 (client credentials)**.

1. Créer une application sur le portail [francetravail.io](https://francetravail.io) → récupérer `client_id` + `client_secret`.
2. Demander un token :

```
POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
client_id=...
client_secret=...
scope=<scope de l'API ciblée>
```

3. Utiliser le token dans l'en-tête `Authorization: Bearer <access_token>`.

- **Base URL des APIs** : `https://api.francetravail.io/partenaire/...`
- Le **scope** dépend de l'API (voir chaque fichier).

> ⚠️ Les pages de documentation officielles sont des SPA Swagger. Les chemins exacts
> de l'API Offres d'emploi sont stables et confirmés. Pour l'API Marché du travail,
> les familles d'indicateurs sont confirmées ; vérifiez les chemins exacts dans le
> Swagger interactif avant intégration.
