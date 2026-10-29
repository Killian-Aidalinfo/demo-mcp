/**
 * Clients des APIs ROME 4.0 (francetravail.io) : Métiers, Fiches métiers, Compétences.
 *
 * Trois APIs distinctes, chacune avec son scope (`api_rome-…v1 nomenclatureRome`) et
 * un quota strict de 1 appel/s : on espace les appels de 1,1 s par API, et
 * `appelerApi` relance une fois sur 429.
 *
 * Le ROME 4.0 a affiné les métiers du numérique : M1801 (administrateur SI) côtoie
 * désormais M1830 (réseaux - télécoms), M1843 (serveurs), M1817 (sécurité)…
 */
import { appelerApi, BASE_PARTENAIRE, type ApiFranceTravail } from "./ft-api";
import { RateLimiter } from "./rate-limit";

function apiRome(nom: string, chemin: string, scope: string): ApiFranceTravail {
  return {
    nom,
    scope: `${scope} nomenclatureRome`,
    base: `${BASE_PARTENAIRE}/${chemin}/v1`,
    limiteur: new RateLimiter(1, 1100),
  };
}

const API_METIERS = apiRome("ROME 4.0 Métiers", "rome-metiers", "api_rome-metiersv1");
const API_FICHES = apiRome("ROME 4.0 Fiches métiers", "rome-fiches-metiers", "api_rome-fiches-metiersv1");
const API_COMPETENCES = apiRome("ROME 4.0 Compétences", "rome-competences", "api_rome-competencesv1");

type Libelle = { code: string; libelle: string };
export type ElementCompetence = Libelle & { type?: string };

export type ResultatRechercheMetier = Libelle & { riasecMajeur?: string; riasecMineur?: string };
export type ResultatRechercheAppellation = Libelle & { metier?: Libelle };

/** Recherche plein texte dans les métiers (fiches ROME). */
export async function rechercherMetiers(q: string): Promise<{ total: number; resultats: ResultatRechercheMetier[] }> {
  const data = await appelerApi<{ totalResultats?: number; resultats?: ResultatRechercheMetier[] }>(
    API_METIERS,
    "/metiers/metier/requete",
    { params: new URLSearchParams({ q }) },
  );
  return { total: data?.totalResultats ?? 0, resultats: data?.resultats ?? [] };
}

/** Recherche plein texte dans les appellations (intitulés de poste rattachés à un métier). */
export async function rechercherAppellations(
  q: string,
): Promise<{ total: number; resultats: ResultatRechercheAppellation[] }> {
  const data = await appelerApi<{ totalResultats?: number; resultats?: ResultatRechercheAppellation[] }>(
    API_METIERS,
    "/metiers/appellation/requete",
    { params: new URLSearchParams({ q }) },
  );
  return { total: data?.totalResultats ?? 0, resultats: data?.resultats ?? [] };
}

export type MetierRome = Libelle & {
  definition?: string;
  accesEmploi?: string;
  emploiCadre?: boolean;
  emploiReglemente?: boolean;
  domaineProfessionnel?: Libelle & { grandDomaine?: Libelle };
  appellations?: (Libelle & { libelleCourt?: string })[];
  competencesMobiliseesPrincipales?: ElementCompetence[];
  contextesTravail?: (Libelle & { categorie?: string })[];
  secteursActivites?: Libelle[];
  [k: string]: unknown;
};

export type FicheMetierRome = {
  code: string;
  groupesCompetencesMobilisees?: { enjeu?: Libelle; competences?: ElementCompetence[] }[];
  groupesSavoirs?: { categorieSavoirs?: Libelle; savoirs?: ElementCompetence[] }[];
  [k: string]: unknown;
};

/** Normalise un code ROME saisi (« m1801 » → « M1801 ») et le valide. */
export function normaliserCodeRome(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-N]\d{4}$/.test(c)) throw new Error(`Code ROME invalide : « ${code} » (attendu : une lettre + 4 chiffres, ex. M1801).`);
  return c;
}

export async function lireMetier(code: string): Promise<MetierRome | null> {
  return appelerApi<MetierRome>(API_METIERS, `/metiers/metier/${normaliserCodeRome(code)}`);
}

export async function lireFicheMetier(code: string): Promise<FicheMetierRome | null> {
  return appelerApi<FicheMetierRome>(API_FICHES, `/fiches-rome/fiche-metier/${normaliserCodeRome(code)}`);
}

export type CompetenceRome = Libelle & {
  type?: string;
  codeOgr?: string;
  definition?: string;
  transitionNumerique?: boolean;
  competenceEsco?: { uri?: string; libelle?: string };
  [k: string]: unknown;
};

export async function lireCompetence(code: string): Promise<CompetenceRome | null> {
  if (!/^\d+$/.test(code.trim())) throw new Error(`Code compétence invalide : « ${code} » (code OGR numérique attendu).`);
  return appelerApi<CompetenceRome>(API_COMPETENCES, `/competences/competence/${code.trim()}`);
}

/** Fiche métier condensée : identité + compétences et savoirs regroupés (fonction pure). */
export type ResumeFicheMetier = {
  code: string;
  libelle: string | null;
  definition: string | null;
  accesEmploi: string | null;
  domaine: string | null;
  appellations: string[];
  competencesPrincipales: string[];
  competencesParEnjeu: { enjeu: string; competences: string[] }[];
  savoirsParCategorie: { categorie: string; savoirs: string[] }[];
  contextesTravail: string[];
};

export function resumerFicheMetier(metier: MetierRome | null, fiche: FicheMetierRome | null): ResumeFicheMetier {
  const code = metier?.code ?? fiche?.code ?? "?";
  return {
    code,
    libelle: metier?.libelle ?? null,
    // L'API échappe les retours à la ligne (« \\n ») dans la définition.
    definition: metier?.definition?.replace(/\\n/g, "\n").trim() ?? null,
    accesEmploi: metier?.accesEmploi?.replace(/\\n/g, "\n").trim() ?? null,
    domaine: metier?.domaineProfessionnel
      ? `${metier.domaineProfessionnel.code} ${metier.domaineProfessionnel.libelle}`
      : null,
    appellations: (metier?.appellations ?? []).map((a) => a.libelleCourt ?? a.libelle),
    competencesPrincipales: (metier?.competencesMobiliseesPrincipales ?? []).map((c) => c.libelle),
    competencesParEnjeu: (fiche?.groupesCompetencesMobilisees ?? [])
      .filter((g) => g.competences?.length)
      .map((g) => ({ enjeu: g.enjeu?.libelle ?? "Autres", competences: g.competences!.map((c) => c.libelle) })),
    savoirsParCategorie: (fiche?.groupesSavoirs ?? [])
      .filter((g) => g.savoirs?.length)
      .map((g) => ({ categorie: g.categorieSavoirs?.libelle ?? "Autres", savoirs: g.savoirs!.map((s) => s.libelle) })),
    contextesTravail: (metier?.contextesTravail ?? []).map((c) => c.libelle),
  };
}
