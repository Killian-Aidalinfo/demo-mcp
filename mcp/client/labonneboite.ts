/**
 * Client de l'API La Bonne Boîte v2 (francetravail.io).
 *
 * Renvoie les entreprises à fort potentiel d'embauche pour un métier autour d'un
 * lieu, qu'elles aient publié une offre ou non : la cible des candidatures spontanées.
 *
 * Pièges :
 *   - scope à trois segments `api_labonneboitev2 search office` ;
 *   - un critère métier (`rome` ou `job`) est obligatoire ;
 *   - `distance` (0 < d < 200 km) ne s'applique qu'avec `citycode` ou `latitude`/`longitude` ;
 *   - `rome` et `naf` sont des tableaux : paramètre répété (rome=M1801&rome=M1810) ;
 *   - 100 résultats max par page, quota de 2 appels/s.
 */
import { appelerApi, BASE_PARTENAIRE, type ApiFranceTravail } from "./ft-api";
import { RateLimiter } from "./rate-limit";

export const SCOPE_LBB = "api_labonneboitev2 search office";

const API_LBB: ApiFranceTravail = {
  nom: "La Bonne Boîte",
  scope: SCOPE_LBB,
  base: `${BASE_PARTENAIRE}/labonneboite/v2`,
  limiteur: new RateLimiter(2, 1000),
};

export const TAILLE_PAGE_LBB_MAX = 100;

export type EntrepriseLbb = {
  id?: number;
  siret?: string;
  rome?: string;
  company_name?: string;
  office_name?: string;
  headcount_min?: number;
  headcount_max?: number;
  naf?: string;
  naf_label?: string;
  city?: string;
  citycode?: string;
  postcode?: string;
  department?: string;
  department_number?: string;
  region?: string;
  location?: { lat?: number; lon?: number };
  hiring_potential?: number;
  is_high_potential?: boolean;
  email?: string;
  [k: string]: unknown;
};

export type CriteresLbb = {
  /** Codes ROME (au moins un). */
  romes: string[];
  /** Code INSEE de la commune (centre de recherche = mairie). */
  codeInsee?: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  /** Codes NAF pour restreindre le secteur des entreprises. */
  naf?: string[];
  page?: number;
  parPage?: number;
};

/** Construit la query string (fonction pure, testable sans réseau). */
export function construireParamsLbb(c: CriteresLbb): URLSearchParams {
  if (c.romes.length === 0) throw new Error("La Bonne Boîte : au moins un code ROME est requis.");
  const params = new URLSearchParams();
  for (const rome of c.romes) params.append("rome", rome.trim().toUpperCase());
  for (const naf of c.naf ?? []) params.append("naf", naf.trim().toUpperCase());
  if (c.latitude !== undefined && c.longitude !== undefined) {
    params.set("latitude", String(c.latitude));
    params.set("longitude", String(c.longitude));
  } else if (c.codeInsee) {
    params.set("citycode", c.codeInsee);
  }
  if (c.distanceKm !== undefined) {
    params.set("distance", String(Math.min(Math.max(Math.round(c.distanceKm), 1), 199)));
  }
  params.set("page", String(c.page ?? 1));
  params.set("page_size", String(Math.min(c.parPage ?? 20, TAILLE_PAGE_LBB_MAX)));
  params.set("sort_by", "hiring_potential");
  params.set("sort_direction", "desc");
  return params;
}

/** Entreprises à fort potentiel d'embauche, triées par potentiel décroissant. */
export async function rechercherEntreprisesQuiRecrutent(
  c: CriteresLbb,
): Promise<{ total: number; entreprises: EntrepriseLbb[] }> {
  const data = await appelerApi<{ hits?: number; items?: EntrepriseLbb[] }>(API_LBB, "/recherche", {
    params: construireParamsLbb(c),
  });
  return { total: data?.hits ?? 0, entreprises: data?.items ?? [] };
}

/** Vue compacte d'une entreprise La Bonne Boîte. */
export type ResumeEntrepriseLbb = {
  siret: string | null;
  entreprise: string | null;
  ville: string | null;
  codePostal: string | null;
  effectif: string | null;
  naf: string | null;
  codeRome: string | null;
  potentielEmbauche: number | null;
  fortPotentiel: boolean;
};

function formaterEffectif(min?: number, max?: number): string | null {
  if (!min && !max) return null;
  if (min !== undefined && max !== undefined && max > 0) return `${min} à ${max} salariés`;
  return `${min ?? max} salariés et plus`;
}

export function resumerEntrepriseLbb(e: EntrepriseLbb): ResumeEntrepriseLbb {
  const nom = e.company_name || null;
  const enseigne = e.office_name && e.office_name !== e.company_name ? e.office_name : null;
  return {
    siret: e.siret ?? null,
    entreprise: nom && enseigne ? `${nom} (${enseigne})` : (nom ?? enseigne),
    ville: e.city ?? null,
    codePostal: e.postcode ?? null,
    effectif: formaterEffectif(e.headcount_min, e.headcount_max),
    naf: e.naf ? (e.naf_label ? `${e.naf} ${e.naf_label}` : e.naf) : null,
    codeRome: e.rome ?? null,
    potentielEmbauche:
      typeof e.hiring_potential === "number" ? Math.round(e.hiring_potential * 100) / 100 : null,
    fortPotentiel: e.is_high_potential === true,
  };
}

/**
 * Une entreprise ressort une fois par code ROME demandé : on garde une ligne par
 * SIRET (le meilleur potentiel), puis on trie par potentiel décroissant (fonction pure).
 */
export function dedoublonnerEntreprises(entreprises: ResumeEntrepriseLbb[]): ResumeEntrepriseLbb[] {
  const parSiret = new Map<string, ResumeEntrepriseLbb>();
  const sansSiret: ResumeEntrepriseLbb[] = [];
  for (const e of entreprises) {
    if (!e.siret) {
      sansSiret.push(e);
      continue;
    }
    const deja = parSiret.get(e.siret);
    if (!deja || (e.potentielEmbauche ?? -1) > (deja.potentielEmbauche ?? -1)) parSiret.set(e.siret, e);
  }
  return [...parSiret.values(), ...sansSiret].sort(
    (a, b) => (b.potentielEmbauche ?? -1) - (a.potentielEmbauche ?? -1),
  );
}
