/**
 * Client de l'API Offres d'emploi v2 (francetravail.io) + ses référentiels.
 *
 * Référence des pièges : voir docs/offres-emploi.md.
 *   - `commune` = code INSEE *connu du référentiel* (Lyon global 69123 refusé →
 *     arrondissements 69381..69389).
 *   - Pagination via `range`, max 150/page, plafond d'index ~3150.
 */
import { getToken } from "./auth";
import { RateLimiter, mapAvecConcurrence } from "./rate-limit";
import {
  TAILLE_PAGE_MAX,
  calculerDebutsPages,
  construireRange,
  parserTotal,
} from "./pagination";

export const SCOPE_OFFRES = "api_offresdemploiv2 o2dsoffre";
const BASE = "https://api.francetravail.io/partenaire/offresdemploi/v2";

// Quota partagé pour tous les appels Offres (~10 req/s).
const limiteur = new RateLimiter(10, 1000);

export type Offre = {
  id?: string;
  intitule?: string;
  description?: string;
  lieuTravail?: { libelle?: string; codePostal?: string; commune?: string };
  entreprise?: { nom?: string };
  typeContrat?: string;
  typeContratLibelle?: string;
  natureContrat?: string;
  alternance?: boolean;
  romeCode?: string;
  romeLibelle?: string;
  salaire?: { libelle?: string };
  dateCreation?: string;
  dateActualisation?: string;
  experienceLibelle?: string;
  formations?: { niveauLibelle?: string; domaineLibelle?: string }[];
  origineOffre?: { urlOrigine?: string; partenaires?: { nom?: string; url?: string }[] };
  [k: string]: unknown;
};

/** Critères de recherche acceptés par `GET /offres/search` (sous-ensemble utile). */
export type CriteresRecherche = {
  motsCles?: string;
  commune?: string;
  departement?: string;
  region?: string;
  codeROME?: string;
  appellation?: string;
  typeContrat?: string;
  natureContrat?: string;
  niveauFormation?: string;
  experience?: string;
  qualification?: string;
  distance?: number;
  inclureLimitrophes?: boolean;
  publieeDepuis?: number;
  minCreationDate?: string;
  maxCreationDate?: string;
  tempsPlein?: boolean;
  salaireMin?: number;
  sort?: number;
};

/**
 * Natures de contrat d'alternance dans le référentiel `naturesContrats`
 * (E2 = contrat d'apprentissage, FS = contrat de professionnalisation).
 */
export const NATURES_ALTERNANCE = ["E2", "FS"] as const;

/** URL publique d'une offre : site d'origine si partenaire, sinon fiche France Travail. */
export function urlOffre(o: Offre): string | null {
  return (
    o.origineOffre?.urlOrigine ??
    (o.id ? `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}` : null)
  );
}

/** Offre réduite aux champs utiles à un modèle (évite de renvoyer l'objet brut, très verbeux). */
export type OffreResumee = {
  id: string | null;
  intitule: string | null;
  entreprise: string | null;
  lieu: string | null;
  codePostal: string | null;
  contrat: string | null;
  natureContrat: string | null;
  alternance: boolean;
  codeRome: string | null;
  experience: string | null;
  formation: string | null;
  salaire: string | null;
  datePublication: string | null;
  url: string | null;
};

export function resumerOffre(o: Offre): OffreResumee {
  const formation = o.formations?.[0];
  return {
    id: o.id ?? null,
    intitule: o.intitule ?? null,
    entreprise: o.entreprise?.nom ?? null,
    lieu: o.lieuTravail?.libelle ?? null,
    codePostal: o.lieuTravail?.codePostal ?? null,
    contrat: o.typeContratLibelle ?? o.typeContrat ?? null,
    natureContrat: o.natureContrat ?? null,
    alternance: o.alternance === true,
    codeRome: o.romeCode ?? null,
    experience: o.experienceLibelle ?? null,
    formation: formation
      ? [formation.niveauLibelle, formation.domaineLibelle].filter(Boolean).join(" — ") || null
      : null,
    salaire: o.salaire?.libelle ?? null,
    datePublication: o.dateCreation ?? null,
    url: urlOffre(o),
  };
}

/** Transforme des critères typés en paramètres de query string (string only). */
export function construireParamsRecherche(
  criteres: CriteresRecherche,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(criteres)) {
    if (valeur === undefined || valeur === null || valeur === "") continue;
    params[cle] = String(valeur);
  }
  return params;
}

async function fetchPageOffres(
  token: string,
  baseParams: Record<string, string>,
  debut: number,
): Promise<{ offres: Offre[]; total: number; status: number }> {
  const params = new URLSearchParams({
    ...baseParams,
    range: construireRange(debut),
  });
  await limiteur.acquire();
  const res = await fetch(`${BASE}/offres/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 204) return { offres: [], total: 0, status: 204 };
  if (res.status !== 200 && res.status !== 206) {
    throw new Error(
      `Recherche d'offres KO (${res.status}) range ${construireRange(debut)} : ${await res.text()}`,
    );
  }

  const total = parserTotal(res.headers.get("Content-Range"));
  const data = (await res.json()) as { resultats?: Offre[] };
  return { offres: data.resultats ?? [], total, status: res.status };
}

/**
 * Recherche d'offres avec pagination automatique jusqu'à `maxResultats`
 * (ou tout ce que l'API autorise, plafonné à l'index ~3150).
 */
export async function rechercherOffres(
  criteres: CriteresRecherche,
  maxResultats = 150,
): Promise<{ total: number; recuperees: number; offres: Offre[] }> {
  const token = await getToken(SCOPE_OFFRES);
  const params = construireParamsRecherche(criteres);

  const premiere = await fetchPageOffres(token, params, 0);
  const total = premiere.total;
  const offres: Offre[] = [...premiere.offres];

  if (maxResultats > TAILLE_PAGE_MAX && total > TAILLE_PAGE_MAX) {
    const cible = Math.min(maxResultats, total);
    const debuts = calculerDebutsPages(cible).filter((d) => d < cible);
    const pages = await mapAvecConcurrence(debuts, 10, (debut) =>
      fetchPageOffres(token, params, debut),
    );
    for (const p of pages) offres.push(...p.offres);
  }

  return { total, recuperees: Math.min(offres.length, maxResultats), offres: offres.slice(0, maxResultats) };
}

/**
 * Recherche les offres en alternance (apprentissage + professionnalisation).
 * Une requête par nature de contrat, puis fusion sans doublon, plus récentes d'abord.
 */
export async function rechercherOffresEnAlternance(
  criteres: Omit<CriteresRecherche, "natureContrat">,
  maxResultats = 150,
): Promise<{ total: number; recuperees: number; offres: Offre[] }> {
  const parNature = await Promise.all(
    NATURES_ALTERNANCE.map((natureContrat) =>
      rechercherOffres({ ...criteres, natureContrat }, maxResultats),
    ),
  );
  const vues = new Set<string>();
  const offres: Offre[] = [];
  for (const r of parNature) {
    for (const o of r.offres) {
      if (o.id && vues.has(o.id)) continue;
      if (o.id) vues.add(o.id);
      offres.push(o);
    }
  }
  offres.sort((a, b) => (b.dateCreation ?? "").localeCompare(a.dateCreation ?? ""));
  const total = parNature.reduce((somme, r) => somme + r.total, 0);
  return {
    total,
    recuperees: Math.min(offres.length, maxResultats),
    offres: offres.slice(0, maxResultats),
  };
}

/** Consulte le détail complet d'une offre par son identifiant. */
export async function consulterOffre(id: string): Promise<Offre | null> {
  const token = await getToken(SCOPE_OFFRES);
  await limiteur.acquire();
  const res = await fetch(`${BASE}/offres/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Consultation d'offre KO (${res.status}) : ${await res.text()}`);
  }
  return (await res.json()) as Offre;
}

/** Référentiels disponibles via `GET /referentiel/{referentiel}`. */
export const REFERENTIELS_OFFRES = [
  "communes",
  "departements",
  "regions",
  "pays",
  "continents",
  "naturesContrats",
  "typesContrats",
  "niveauxFormations",
  "permis",
  "langues",
  "domaines",
  "appellations",
  "metiers",
  "nafs",
  "secteursActivites",
  "themes",
] as const;
export type ReferentielOffres = (typeof REFERENTIELS_OFFRES)[number];

export type EntreeReferentiel = { code: string; libelle: string; [k: string]: unknown };

/** Récupère un référentiel complet (ex. `communes` = tous les codes INSEE). */
export async function getReferentiel(
  referentiel: ReferentielOffres,
): Promise<EntreeReferentiel[]> {
  const token = await getToken(SCOPE_OFFRES);
  await limiteur.acquire();
  const res = await fetch(`${BASE}/referentiel/${referentiel}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Référentiel ${referentiel} KO (${res.status}) : ${await res.text()}`);
  }
  return (await res.json()) as EntreeReferentiel[];
}

/** Normalise une chaîne pour comparaison insensible casse/accents. */
export function normaliser(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Filtre une liste de référentiel par libellé (et/ou code).
 * Fonction pure → testable sans réseau. Renvoie au plus `limite` résultats.
 */
export function filtrerReferentiel(
  entrees: EntreeReferentiel[],
  recherche: string,
  limite = 20,
): EntreeReferentiel[] {
  const q = normaliser(recherche);
  return entrees
    .filter(
      (e) =>
        normaliser(e.libelle ?? "").includes(q) ||
        normaliser(String(e.code ?? "")).includes(q),
    )
    .slice(0, limite);
}

/**
 * Recherche un code (INSEE pour communes, code dept/region…) par nom dans un référentiel.
 * Pratique pour aider l'IA à construire ses requêtes : "Lyon" → codes INSEE.
 */
export async function chercherDansReferentiel(
  referentiel: ReferentielOffres,
  recherche: string,
  limite = 20,
): Promise<EntreeReferentiel[]> {
  const entrees = await getReferentiel(referentiel);
  return filtrerReferentiel(entrees, recherche, limite);
}
