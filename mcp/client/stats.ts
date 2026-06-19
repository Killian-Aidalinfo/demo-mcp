/**
 * Client de l'API Marché du travail (stats-offres-demandes-emploi v1).
 *
 * Pièges (voir docs/marche-travail.md & mémoire projet) :
 *   - Scope DOUBLE obligatoire : sans le second segment → 403 sur la ressource.
 *   - Répond en XML par défaut → on force `Accept: application/json`.
 *   - Chaque indicateur impose des `codeTypeNomenclature` valides (découvrables
 *     via `GET /referentiel/details-indicateurs`). Ex. stat-offres → ORIGINEOFF.
 */
import { getToken } from "./auth";
import { RateLimiter } from "./rate-limit";

export const SCOPE_STATS =
  "api_stats-offres-demandes-emploiv1 offresetdemandesemploi";
const BASE =
  "https://api.francetravail.io/partenaire/stats-offres-demandes-emploi/v1";

const limiteur = new RateLimiter(10, 1000);

/** Indicateurs statistiques exposés via POST /indicateur/{indicateur}. */
export const INDICATEURS = {
  "stat-offres": "Offres d'emploi collectées",
  "stat-demandeurs": "Demandeurs d'emploi (stock DEFM)",
  "stat-demandeurs-entrant": "Entrées de demandeurs (flux DEE)",
  "stat-embauches": "Embauches / recrutements",
  "stat-dynamique-emploi": "Dynamique d'emploi du territoire",
  "stat-perspective-employeur": "Tension / perspectives de recrutement",
} as const;
export type Indicateur = keyof typeof INDICATEURS;

/** Corps conforme au schéma CritereIndicateurAvecNomenclature. */
export type CritereStats = {
  codeTypeTerritoire: string; // ex. "REG", "DEP", "NAT"
  codeTerritoire: string; // ex. "84" (Auvergne-Rhône-Alpes)
  codeTypeActivite?: string; // ex. "ROME"
  codeActivite?: string; // ex. "M1805"
  codeTypePeriode?: string; // ex. "TRIMESTRE", "ANNEE"
  codeTypeNomenclature?: string; // ex. "ORIGINEOFF"
  dernierePeriode?: boolean;
  codePeriode?: string;
};

export type ValeurStat = {
  libTerritoire?: string;
  libActivite?: string;
  libNomenclature?: string;
  libPeriode?: string;
  valeurPrincipaleNombre?: number;
  valeurSecondairePourcentage?: number;
  [k: string]: unknown;
};

export type ReponseStats = {
  codeIndicateur?: string;
  libIndicateur?: string;
  listeValeursParPeriode?: ValeurStat[];
  [k: string]: unknown;
};

/** Interroge un indicateur statistique du marché du travail. */
export async function statistiquesMarche(
  indicateur: Indicateur,
  critere: CritereStats,
): Promise<ReponseStats> {
  const token = await getToken(SCOPE_STATS);
  await limiteur.acquire();
  const res = await fetch(`${BASE}/indicateur/${indicateur}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json", // sinon réponse XML
    },
    body: JSON.stringify(critere),
  });

  if (!res.ok) {
    throw new Error(
      `Indicateur ${indicateur} KO (${res.status}) — payload ${JSON.stringify(critere)} : ${await res.text()}`,
    );
  }
  return (await res.json()) as ReponseStats;
}

export type Territoire = { code?: string; libelle?: string; [k: string]: unknown };

/**
 * Liste les territoires d'un type donné (ex. "REG" → toutes les régions avec
 * leur code, "DEP" → départements). Aide l'IA à trouver le bon codeTerritoire.
 */
export async function listerTerritoires(
  codeTypeTerritoire: string,
): Promise<Territoire[]> {
  const token = await getToken(SCOPE_STATS);
  await limiteur.acquire();
  const res = await fetch(
    `${BASE}/referentiel/territoires/${encodeURIComponent(codeTypeTerritoire)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`Territoires ${codeTypeTerritoire} KO (${res.status}) : ${await res.text()}`);
  }
  const data = await res.json();
  // L'API peut renvoyer un tableau ou un objet enveloppe selon le contexte.
  return Array.isArray(data) ? (data as Territoire[]) : ((data as any)?.territoires ?? []);
}

/**
 * Découvre les combinaisons valides (indicateur × activité × nomenclature × période).
 * Indispensable pour construire un appel statistiques sans se tromper de nomenclature.
 */
export async function detailsIndicateurs(): Promise<unknown> {
  const token = await getToken(SCOPE_STATS);
  await limiteur.acquire();
  const res = await fetch(`${BASE}/referentiel/details-indicateurs`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`details-indicateurs KO (${res.status}) : ${await res.text()}`);
  }
  return res.json();
}
