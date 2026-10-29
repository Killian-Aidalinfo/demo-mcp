/**
 * Client de l'API ROMEO v2 (francetravail.io) : rapprochement d'un texte libre
 * (intitulé de poste, compétence) avec le référentiel ROME 4.0 par IA.
 *
 * Pièges :
 *   - `options.nomAppelant` est obligatoire ;
 *   - chaque intitulé porte un `identifiant` choisi par l'appelant, renvoyé tel quel ;
 *   - le `contexte` (secteur, type de contrat…) aide la prédiction ;
 *   - quota de 3 appels/s, 1 à 25 prédictions par intitulé.
 */
import { appelerApi, BASE_PARTENAIRE, type ApiFranceTravail } from "./ft-api";
import { RateLimiter } from "./rate-limit";

export const SCOPE_ROMEO = "api_romeov2";
const NOM_APPELANT = "mcp-france-travail";

const API_ROMEO: ApiFranceTravail = {
  nom: "ROMEO",
  scope: SCOPE_ROMEO,
  base: `${BASE_PARTENAIRE}/romeo/v2`,
  limiteur: new RateLimiter(3, 1000),
};

export type MetierPredit = {
  codeRome: string;
  libelleRome: string;
  codeAppellation: string;
  libelleAppellation: string;
  scorePrediction: number;
};

export type CompetencePredite = {
  codeCompetence: string;
  libelleCompetence: string;
  typeCompetence?: string;
  scorePrediction: number;
  [k: string]: unknown;
};

function borner(nb: number): number {
  return Math.min(Math.max(Math.round(nb), 1), 25);
}

/** Corps de `POST /predictionMetiers` (fonction pure, testable sans réseau). */
export function construireCorpsPredictionMetiers(intitule: string, contexte?: string, nbResultats = 5) {
  return {
    appellations: [{ intitule, identifiant: "1", ...(contexte ? { contexte } : {}) }],
    options: { nomAppelant: NOM_APPELANT, nbResultats: borner(nbResultats) },
  };
}

/** Métiers ROME les plus proches d'un intitulé libre, meilleur score d'abord. */
export async function predireMetiers(
  intitule: string,
  contexte?: string,
  nbResultats = 5,
): Promise<MetierPredit[]> {
  const data = await appelerApi<{ metiersRome?: MetierPredit[] }[]>(API_ROMEO, "/predictionMetiers", {
    corps: construireCorpsPredictionMetiers(intitule, contexte, nbResultats),
  });
  return [...(data?.[0]?.metiersRome ?? [])].sort((a, b) => b.scorePrediction - a.scorePrediction);
}

/** Compétences ROME les plus proches d'un libellé libre, meilleur score d'abord. */
export async function predireCompetences(
  intitule: string,
  contexte?: string,
  nbResultats = 5,
): Promise<CompetencePredite[]> {
  const data = await appelerApi<{ competencesRome?: CompetencePredite[] }[]>(
    API_ROMEO,
    "/predictionCompetences",
    {
      corps: {
        competences: [{ intitule, identifiant: "1", ...(contexte ? { contexte } : {}) }],
        options: { nomAppelant: NOM_APPELANT, nbResultats: borner(nbResultats) },
      },
    },
  );
  return [...(data?.[0]?.competencesRome ?? [])].sort((a, b) => b.scorePrediction - a.scorePrediction);
}
