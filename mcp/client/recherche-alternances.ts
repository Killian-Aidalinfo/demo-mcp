/**
 * Recherche d'alternances sur toutes les sources à la fois.
 *
 * Interroge en parallèle France Travail (natures E2 + FS) et La bonne alternance,
 * puis fusionne les résultats dans un format commun et retire les doublons :
 * La bonne alternance republie une partie des offres France Travail.
 *
 * Une source en erreur (identifiants absents, quota…) n'empêche pas l'autre de
 * répondre : l'erreur est renvoyée dans `avertissements`.
 */
import { localiserCommunes, type Commune } from "./geo";
import { normaliser, rechercherOffresEnAlternance, resumerOffre, type OffreResumee } from "./offres";
import {
  rechercherOffresAlternance,
  resumerOffreAlternance,
  resumerRecruteur,
  type ResumeOffreAlternance,
  type ResumeRecruteur,
} from "./alternance";

export type OffreUnifiee = {
  source: string;
  id: string | null;
  /** Tool à appeler avec `id` pour le détail (null si l'offre n'a pas d'identifiant consultable). */
  outilDetail: "consulter_offre" | "consulter_offre_alternance" | null;
  intitule: string | null;
  entreprise: string | null;
  lieu: string | null;
  contrat: string | null;
  niveau: string | null;
  datePublication: string | null;
  url: string | null;
};

export function unifierOffreFranceTravail(o: OffreResumee): OffreUnifiee {
  return {
    source: "France Travail",
    id: o.id,
    outilDetail: o.id ? "consulter_offre" : null,
    intitule: o.intitule,
    entreprise: o.entreprise,
    lieu: o.lieu,
    contrat: [o.contrat, o.natureContrat].filter(Boolean).join(" · ") || null,
    niveau: o.formation,
    datePublication: o.datePublication,
    url: o.url,
  };
}

export function unifierOffreLba(o: ResumeOffreAlternance): OffreUnifiee {
  return {
    source: o.source ? `La bonne alternance (${o.source})` : "La bonne alternance",
    id: o.id,
    outilDetail: o.id ? "consulter_offre_alternance" : null,
    intitule: o.intitule,
    entreprise: o.entreprise,
    lieu: o.adresse,
    contrat: o.typeContrat,
    niveau: o.niveauVise,
    datePublication: o.datePublication,
    url: o.url,
  };
}

/** Premier code postal (5 chiffres) trouvé dans une adresse libre. */
export function extraireCodePostal(adresse: string | null): string | null {
  return adresse?.match(/\b\d{5}\b/)?.[0] ?? null;
}

/**
 * Clé de rapprochement approximative : même intitulé, même entreprise, même code postal.
 * Le code postal évite de fusionner une annonce publiée dans plusieurs communes
 * (fréquent chez les écoles et les agences), qui correspond à des postes distincts.
 */
function cleApprochee(
  intitule: string | null,
  entreprise: string | null,
  codePostal: string | null,
): string | null {
  if (!intitule || !entreprise || !codePostal) return null;
  const simplifier = (t: string) => normaliser(t).replace(/\W+/g, " ").trim();
  return `${simplifier(intitule)}|${simplifier(entreprise)}|${codePostal}`;
}

/**
 * Fusionne les deux sources sans doublon (fonction pure).
 * Une offre La bonne alternance est écartée si elle reprend une offre France Travail
 * déjà présente : même identifiant partenaire, ou même intitulé + entreprise + code postal.
 * Tri final : plus récentes d'abord.
 */
export function fusionnerAlternances(
  franceTravail: OffreResumee[],
  lba: ResumeOffreAlternance[],
): { offres: OffreUnifiee[]; doublonsRetires: number } {
  const idsFt = new Set(franceTravail.map((o) => o.id).filter(Boolean) as string[]);
  const clesVues = new Set<string>();
  const offres: OffreUnifiee[] = [];
  let doublonsRetires = 0;

  for (const o of franceTravail) {
    const cle = cleApprochee(o.intitule, o.entreprise, o.codePostal);
    if (cle && clesVues.has(cle)) {
      doublonsRetires++;
      continue;
    }
    if (cle) clesVues.add(cle);
    offres.push(unifierOffreFranceTravail(o));
  }

  for (const o of lba) {
    const cle = cleApprochee(o.intitule, o.entreprise, extraireCodePostal(o.adresse));
    if ((o.idPartenaire && idsFt.has(o.idPartenaire)) || (cle && clesVues.has(cle))) {
      doublonsRetires++;
      continue;
    }
    if (cle) clesVues.add(cle);
    offres.push(unifierOffreLba(o));
  }

  offres.sort((a, b) => (b.datePublication ?? "").localeCompare(a.datePublication ?? ""));
  return { offres, doublonsRetires };
}

export type CriteresAlternances = {
  /** Nom, code postal ou code INSEE de la ville autour de laquelle chercher. */
  ville: string;
  rayonKm?: number;
  /** Codes ROME séparés par des virgules (ex. M1801,M1810). */
  romes?: string;
  /** Mots-clés (France Travail uniquement). */
  motsCles?: string;
  /** Niveau de diplôme visé, nomenclature européenne 3..7 (La bonne alternance uniquement). */
  niveauDiplome?: string;
  /** Offres publiées depuis N jours (France Travail uniquement). */
  publieeDepuis?: number;
  maxParSource?: number;
  inclureRecruteurs?: boolean;
};

export type ResultatAlternances = {
  commune: Commune;
  offres: OffreUnifiee[];
  parSource: { franceTravail: number | null; laBonneAlternance: number | null };
  doublonsRetires: number;
  recruteurs: ResumeRecruteur[];
  avertissements: string[];
};

function messageErreur(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function rechercherAlternances(c: CriteresAlternances): Promise<ResultatAlternances> {
  const [commune] = await localiserCommunes(c.ville, 1);
  if (!commune) throw new Error(`Commune introuvable : « ${c.ville} ».`);
  const rayon = c.rayonKm ?? 30;
  const max = c.maxParSource ?? 100;

  const [ft, lba] = await Promise.allSettled([
    rechercherOffresEnAlternance(
      {
        commune: commune.codeInsee,
        distance: rayon,
        codeROME: c.romes,
        motsCles: c.motsCles,
        publieeDepuis: c.publieeDepuis,
      },
      max,
    ),
    commune.latitude !== undefined && commune.longitude !== undefined
      ? rechercherOffresAlternance({
          latitude: commune.latitude,
          longitude: commune.longitude,
          radius: rayon,
          romes: c.romes,
          target_diploma_level: c.niveauDiplome,
        })
      : Promise.reject(new Error(`Coordonnées GPS inconnues pour ${commune.nom}.`)),
  ]);

  const avertissements: string[] = [];
  const offresFt = ft.status === "fulfilled" ? ft.value.offres.map(resumerOffre) : [];
  if (ft.status === "rejected") avertissements.push(`France Travail indisponible : ${messageErreur(ft.reason)}`);

  let offresLba: ResumeOffreAlternance[] = [];
  let recruteurs: ResumeRecruteur[] = [];
  if (lba.status === "fulfilled") {
    offresLba = lba.value.offres.slice(0, max).map((o) => resumerOffreAlternance(o));
    if (c.inclureRecruteurs) recruteurs = lba.value.recruteurs.map(resumerRecruteur);
    avertissements.push(...lba.value.avertissements.map((a) => `La bonne alternance : ${a.message}`));
  } else {
    avertissements.push(`La bonne alternance indisponible : ${messageErreur(lba.reason)}`);
  }

  const { offres, doublonsRetires } = fusionnerAlternances(offresFt, offresLba);
  return {
    commune,
    offres,
    parSource: {
      franceTravail: ft.status === "fulfilled" ? offresFt.length : null,
      laBonneAlternance: lba.status === "fulfilled" ? offresLba.length : null,
    },
    doublonsRetires,
    recruteurs,
    avertissements,
  };
}
