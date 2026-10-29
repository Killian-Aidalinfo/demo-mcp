/**
 * Géolocalisation des communes via l'API Découpage administratif (geo.api.gouv.fr).
 *
 * API publique, gratuite et sans clé. Elle sert de pont entre les deux sources :
 *   - France Travail attend un code INSEE de commune (+ `distance`) ;
 *   - La bonne alternance attend des coordonnées GPS (+ `radius`).
 * Un seul appel donne les deux.
 */
const BASE = "https://geo.api.gouv.fr";

export type Commune = {
  codeInsee: string;
  nom: string;
  codesPostaux: string[];
  departement: string;
  population?: number;
  latitude?: number;
  longitude?: number;
};

type CommuneApi = {
  code: string;
  nom: string;
  codesPostaux?: string[];
  codeDepartement?: string;
  population?: number;
  centre?: { type: string; coordinates: [number, number] };
};

/** Convertit une commune brute de l'API en objet compact (GeoJSON = [lon, lat]). */
export function convertirCommune(c: CommuneApi): Commune {
  return {
    codeInsee: c.code,
    nom: c.nom,
    codesPostaux: c.codesPostaux ?? [],
    departement: c.codeDepartement ?? "",
    population: c.population,
    longitude: c.centre?.coordinates[0],
    latitude: c.centre?.coordinates[1],
  };
}

/**
 * Construit les paramètres de recherche par liste : 5 chiffres → code postal, sinon nom.
 * Un code INSEE (ex. 54395) passe d'abord par `/communes/{code}` (cf. localiserCommunes).
 */
export function construireParamsGeo(
  recherche: string,
  limite: number,
): URLSearchParams {
  const params = new URLSearchParams({
    fields: "code,nom,codesPostaux,codeDepartement,population,centre",
    limit: String(limite),
  });
  const q = recherche.trim();
  if (/^\d{5}$/.test(q)) {
    params.set("codePostal", q);
  } else {
    params.set("nom", q);
    params.set("boost", "population");
  }
  return params;
}

/**
 * Trouve les communes correspondant à un nom, un code postal ou un code INSEE,
 * triées par pertinence (les plus peuplées d'abord pour une recherche par nom).
 */
export async function localiserCommunes(recherche: string, limite = 5): Promise<Commune[]> {
  const q = recherche.trim();
  const champs = "code,nom,codesPostaux,codeDepartement,population,centre";

  // Code INSEE exact (ex. 2A004, 54395) : on tente d'abord la ressource directe.
  if (/^(\d{5}|2[AB]\d{3})$/i.test(q)) {
    const res = await fetch(`${BASE}/communes/${q.toUpperCase()}?fields=${champs}`);
    if (res.ok) return [convertirCommune((await res.json()) as CommuneApi)];
    if (res.status !== 404) {
      throw new Error(`Localisation de « ${q} » KO (${res.status}) : ${await res.text()}`);
    }
    if (!/^\d{5}$/.test(q)) return [];
  }

  const res = await fetch(`${BASE}/communes?${construireParamsGeo(q, limite)}`);
  if (!res.ok) {
    throw new Error(`Localisation de « ${q} » KO (${res.status}) : ${await res.text()}`);
  }
  return ((await res.json()) as CommuneApi[]).slice(0, limite).map(convertirCommune);
}
