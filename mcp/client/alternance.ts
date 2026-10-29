/**
 * Client de l'API « La bonne alternance » (api.apprentissage.beta.gouv.fr).
 *
 * Offres d'emploi en alternance (apprentissage / professionnalisation), entreprises
 * susceptibles de recruter (candidature spontanée) et formations en apprentissage.
 *
 * Pièges connus :
 *   - Auth par clé d'API (`Authorization: Bearer <clé>`), lue dans `LBA_API_KEY`.
 *   - Quota : 60 appels/min sur la recherche d'offres (120/min sur le détail) → un
 *     limiteur partagé à 60 req / 60 s pour tous les appels de ce client.
 *   - `departements` est un tableau → paramètre répété (`departements=54&departements=57`).
 *   - `target_diploma_level` renvoie AUSSI les offres dont le niveau n'est pas précisé.
 *   - `identifier.id` est `null` pour les offres France Travail (récupérées à la volée,
 *     non stockées chez LBA) : elles ne sont pas consultables via `/job/v1/offer/{id}`.
 *   - `warnings` n'est pas une erreur : on le renvoie tel quel à l'appelant.
 */
import { RateLimiter } from "./rate-limit";

const BASE = "https://api.apprentissage.beta.gouv.fr/api";

// Quota partagé pour tous les appels La bonne alternance (60 req/min).
const limiteur = new RateLimiter(60, 60_000);

/** Longueur max de la description dans un résumé de liste. */
export const LONGUEUR_DESCRIPTION_RESUME = 600;

// ─── Types (forme de l'API, cf. OpenAPI JobOfferRead / JobRecruiter / Formation) ─────

export type GeoJsonPoint = { type: "Point"; coordinates: [number, number] };

export type LieuTravailLba = {
  name?: string | null;
  brand?: string | null;
  legal_name?: string | null;
  siret?: string | null;
  size?: string | null;
  website?: string | null;
  description?: string | null;
  location?: { address?: string; geopoint?: GeoJsonPoint };
  domain?: {
    opco?: string | null;
    idcc?: number | null;
    naf?: { code: string; label?: string | null } | null;
  };
};

export type CandidatureLba = {
  url?: string;
  phone?: string | null;
  recipient_id?: string | null;
};

export type OffreAlternanceLba = {
  identifier?: { id?: string | null; partner_label?: string; partner_job_id?: string };
  workplace?: LieuTravailLba;
  apply?: CandidatureLba;
  contract?: {
    start?: string | null;
    duration?: number | null;
    type?: string[];
    remote?: "onsite" | "remote" | "hybrid" | null;
    start_type?: string | null;
    start_is_flexible?: boolean | null;
  };
  offer?: {
    title?: string;
    description?: string;
    desired_skills?: string[];
    to_be_acquired_skills?: string[];
    access_conditions?: string[];
    opening_count?: number;
    publication?: { creation?: string | null; expiration?: string | null };
    rome_codes?: string[];
    target_diploma?: { european?: string; label?: string } | null;
    status?: string;
  };
  [k: string]: unknown;
};

export type RecruteurLba = {
  identifier?: { id?: string };
  workplace?: LieuTravailLba;
  apply?: CandidatureLba;
  [k: string]: unknown;
};

export type AvertissementLba = { message: string; code: string };

type AdresseLba = {
  label?: string | null;
  code_postal?: string | null;
  commune?: { nom?: string; code_insee?: string };
  departement?: { nom?: string; code_insee?: string };
};

type OrganismeLba = {
  identifiant?: { uai?: string | null; siret?: string };
  etablissement?: { enseigne?: string | null; adresse?: AdresseLba | null };
  unite_legale?: { raison_sociale?: string };
};

export type FormationLba = {
  identifiant?: { cle_ministere_educatif?: string };
  formateur?: { organisme?: OrganismeLba | null };
  responsable?: { organisme?: OrganismeLba | null };
  certification?: {
    valeur?: {
      identifiant?: { cfd?: string | null; rncp?: string | null };
      intitule?: {
        cfd?: { long?: string; court?: string } | null;
        rncp?: string | null;
        niveau?: {
          cfd?: { europeen?: string | null; libelle?: string | null } | null;
          rncp?: { europeen?: string | null } | null;
        };
      };
      domaines?: { rome?: { rncp?: { code?: string; intitule?: string }[] | null } };
    };
  };
  lieu?: { adresse?: AdresseLba; geolocalisation?: GeoJsonPoint };
  contact?: { email?: string | null; telephone?: string | null };
  onisep?: { url?: string | null; intitule?: string | null };
  modalite?: { entierement_a_distance?: boolean; duree_indicative?: number };
  sessions?: { debut?: string; fin?: string; capacite?: number | null }[];
  [k: string]: unknown;
};

// ─── Critères ───────────────────────────────────────────────────────────────────────

/** Critères de `GET /job/v1/search` (noms de l'API). */
export type CriteresAlternance = {
  latitude?: number;
  longitude?: number;
  radius?: number;
  target_diploma_level?: string;
  romes?: string;
  rncp?: string;
  opco?: string;
  departements?: string[];
  partners_to_exclude?: string[];
};

/** Critères de `GET /formation/v1/search` (noms de l'API). */
export type CriteresFormationAlternance = {
  latitude?: number;
  longitude?: number;
  radius?: number;
  target_diploma_level?: string;
  romes?: string;
  rncp?: string;
  page_size?: number;
  page_index?: number;
};

/**
 * Transforme des critères typés en `URLSearchParams`. Les tableaux (`departements`,
 * `partners_to_exclude`) deviennent des paramètres répétés ; les valeurs vides sont ignorées.
 */
export function construireParamsAlternance(
  criteres: CriteresAlternance | CriteresFormationAlternance,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(criteres)) {
    if (valeur === undefined || valeur === null || valeur === "") continue;
    if (Array.isArray(valeur)) {
      for (const v of valeur) {
        if (v !== undefined && v !== null && v !== "") params.append(cle, String(v));
      }
      continue;
    }
    params.append(cle, String(valeur));
  }
  return params;
}

// ─── Résumés (fonctions pures) ────────────────────────────────────────────────────────

/** Vue compacte d'une offre d'alternance, prête à être renvoyée au modèle. */
export type ResumeOffreAlternance = {
  id: string | null;
  source: string | null;
  idPartenaire: string | null;
  intitule: string | null;
  entreprise: string | null;
  adresse: string | null;
  siret: string | null;
  taille: string | null;
  typeContrat: string | null;
  debut: string | null;
  dureeMois: number | null;
  teletravail: string | null;
  niveauVise: string | null;
  codesRome: string[];
  datePublication: string | null;
  dateExpiration: string | null;
  url: string | null;
  telephone: string | null;
  description: string | null;
};

/** Vue compacte d'une entreprise susceptible de recruter (sans offre publiée). */
export type ResumeRecruteur = {
  id: string | null;
  entreprise: string | null;
  adresse: string | null;
  siret: string | null;
  taille: string | null;
  naf: string | null;
  url: string | null;
  telephone: string | null;
};

/** Vue compacte d'une formation en apprentissage. */
export type ResumeFormationAlternance = {
  id: string | null;
  intitule: string | null;
  niveau: string | null;
  rncp: string | null;
  cfd: string | null;
  organisme: string | null;
  adresse: string | null;
  codesRome: string[];
  sessions: { debut: string | null; fin: string | null }[];
  aDistance: boolean | null;
  dureeIndicative: number | null;
  email: string | null;
  telephone: string | null;
  url: string | null;
};

/** Tronque un texte à `max` caractères (avec « … »), `null` si vide. */
export function tronquer(texte: string | null | undefined, max: number): string | null {
  if (!texte) return null;
  const t = texte.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function nomEntreprise(w: LieuTravailLba | undefined): string | null {
  return w?.brand ?? w?.name ?? w?.legal_name ?? null;
}

const LIBELLES_TELETRAVAIL: Record<string, string> = {
  onsite: "sur site",
  remote: "télétravail",
  hybrid: "hybride",
};

/** Résume une offre (`JobOfferRead`) en objet compact. */
export function resumerOffreAlternance(
  job: OffreAlternanceLba,
  longueurDescription = LONGUEUR_DESCRIPTION_RESUME,
): ResumeOffreAlternance {
  const remote = job.contract?.remote ?? null;
  const types = job.contract?.type ?? [];
  return {
    id: job.identifier?.id ?? null,
    source: job.identifier?.partner_label ?? null,
    idPartenaire: job.identifier?.partner_job_id ?? null,
    intitule: job.offer?.title ?? null,
    entreprise: nomEntreprise(job.workplace),
    adresse: job.workplace?.location?.address ?? null,
    siret: job.workplace?.siret ?? null,
    taille: job.workplace?.size ?? null,
    typeContrat: types.length ? types.join(", ") : null,
    debut: job.contract?.start ?? null,
    dureeMois: job.contract?.duration ?? null,
    teletravail: remote ? (LIBELLES_TELETRAVAIL[remote] ?? remote) : null,
    niveauVise: job.offer?.target_diploma?.label ?? null,
    codesRome: job.offer?.rome_codes ?? [],
    datePublication: job.offer?.publication?.creation ?? null,
    dateExpiration: job.offer?.publication?.expiration ?? null,
    url: job.apply?.url ?? null,
    telephone: job.apply?.phone ?? null,
    description: tronquer(job.offer?.description, longueurDescription),
  };
}

/** Résume un recruteur potentiel (`JobRecruiter`) en objet compact. */
export function resumerRecruteur(r: RecruteurLba): ResumeRecruteur {
  const naf = r.workplace?.domain?.naf;
  return {
    id: r.identifier?.id ?? null,
    entreprise: nomEntreprise(r.workplace),
    adresse: r.workplace?.location?.address ?? null,
    siret: r.workplace?.siret ?? null,
    taille: r.workplace?.size ?? null,
    naf: naf ? (naf.label ? `${naf.code} ${naf.label}` : naf.code) : null,
    url: r.apply?.url ?? null,
    telephone: r.apply?.phone ?? null,
  };
}

function formaterAdresse(a: AdresseLba | null | undefined): string | null {
  if (!a) return null;
  if (a.label) return a.label;
  const morceaux = [a.code_postal, a.commune?.nom].filter(Boolean);
  return morceaux.length ? morceaux.join(" ") : null;
}

/** Résume une formation (`Formation`) en objet compact. */
export function resumerFormationAlternance(f: FormationLba): ResumeFormationAlternance {
  const cert = f.certification?.valeur;
  const orga = f.formateur?.organisme ?? f.responsable?.organisme ?? null;
  const niveau = cert?.intitule?.niveau;
  const europeen = niveau?.cfd?.europeen ?? niveau?.rncp?.europeen ?? null;
  return {
    id: f.identifiant?.cle_ministere_educatif ?? null,
    intitule: cert?.intitule?.cfd?.long ?? cert?.intitule?.rncp ?? f.onisep?.intitule ?? null,
    niveau: niveau?.cfd?.libelle ?? (europeen ? `niveau ${europeen}` : null),
    rncp: cert?.identifiant?.rncp ?? null,
    cfd: cert?.identifiant?.cfd ?? null,
    organisme: orga?.etablissement?.enseigne ?? orga?.unite_legale?.raison_sociale ?? null,
    adresse: formaterAdresse(f.lieu?.adresse),
    codesRome: (cert?.domaines?.rome?.rncp ?? [])
      .map((r) => r?.code)
      .filter((c): c is string => typeof c === "string"),
    sessions: (f.sessions ?? []).map((s) => ({ debut: s.debut ?? null, fin: s.fin ?? null })),
    aDistance: f.modalite?.entierement_a_distance ?? null,
    dureeIndicative: f.modalite?.duree_indicative ?? null,
    email: f.contact?.email ?? null,
    telephone: f.contact?.telephone ?? null,
    url: f.onisep?.url ?? null,
  };
}

// ─── Appels réseau ────────────────────────────────────────────────────────────────

function lireCleApi(): string {
  const cle = process.env.LBA_API_KEY;
  if (!cle) {
    throw new Error(
      "LBA_API_KEY manquante. Renseigne-la dans le fichier .env (ou le bloc `env` du client MCP) : " +
        "la clé d'API « La bonne alternance » s'obtient gratuitement sur https://api.apprentissage.beta.gouv.fr.",
    );
  }
  return cle;
}

async function appelerLba(chemin: string, params?: URLSearchParams): Promise<Response> {
  const cle = lireCleApi();
  await limiteur.acquire();
  const qs = params && params.toString() ? `?${params}` : "";
  return fetch(`${BASE}${chemin}${qs}`, {
    headers: { Authorization: `Bearer ${cle}`, Accept: "application/json" },
  });
}

/** Recherche d'offres d'alternance (+ recruteurs potentiels) via `GET /job/v1/search`. */
export async function rechercherOffresAlternance(criteres: CriteresAlternance): Promise<{
  offres: OffreAlternanceLba[];
  recruteurs: RecruteurLba[];
  avertissements: AvertissementLba[];
}> {
  const res = await appelerLba("/job/v1/search", construireParamsAlternance(criteres));
  if (!res.ok) {
    throw new Error(`Recherche d'offres d'alternance KO (${res.status}) : ${await res.text()}`);
  }
  const data = (await res.json()) as {
    jobs?: OffreAlternanceLba[];
    recruiters?: RecruteurLba[];
    warnings?: AvertissementLba[];
  };
  return {
    offres: data.jobs ?? [],
    recruteurs: data.recruiters ?? [],
    avertissements: data.warnings ?? [],
  };
}

/** Consulte une offre d'alternance par son identifiant LBA (`null` si introuvable). */
export async function consulterOffreAlternance(id: string): Promise<OffreAlternanceLba | null> {
  const res = await appelerLba(`/job/v1/offer/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Consultation d'offre d'alternance KO (${res.status}) : ${await res.text()}`);
  }
  return (await res.json()) as OffreAlternanceLba;
}

/** Recherche de formations en apprentissage via `GET /formation/v1/search`. */
export async function rechercherFormationsAlternance(
  criteres: CriteresFormationAlternance,
): Promise<{
  formations: FormationLba[];
  pagination: { page_count?: number; page_size?: number; page_index?: number };
}> {
  const res = await appelerLba("/formation/v1/search", construireParamsAlternance(criteres));
  if (!res.ok) {
    throw new Error(`Recherche de formations en apprentissage KO (${res.status}) : ${await res.text()}`);
  }
  const data = (await res.json()) as {
    data?: FormationLba[];
    pagination?: { page_count?: number; page_size?: number; page_index?: number };
  };
  return { formations: data.data ?? [], pagination: data.pagination ?? {} };
}
