/**
 * Appel générique d'une API partenaire France Travail (api.francetravail.io).
 *
 * Mutualise ce que les clients ROME, ROMEO et La Bonne Boîte répètent :
 *   - jeton OAuth2 du scope de l'API (cache par scope, cf. auth.ts) ;
 *   - quota propre à chaque API (1 appel/s pour ROME 4.0, 2/s pour La Bonne Boîte…) ;
 *   - `Accept: application/json` (certaines APIs répondent en XML sinon) ;
 *   - une seule relance sur 429, après le délai `Retry-After` (borné à 5 s).
 */
import { getToken } from "./auth";
import { RateLimiter } from "./rate-limit";

export const BASE_PARTENAIRE = "https://api.francetravail.io/partenaire";

export type ApiFranceTravail = {
  /** Nom lisible, repris dans les messages d'erreur. */
  nom: string;
  scope: string;
  base: string;
  limiteur: RateLimiter;
};

const DELAI_RELANCE_MAX_MS = 5_000;

function delaiRelance(res: Response): number {
  const secondes = Number(res.headers.get("Retry-After"));
  return Number.isFinite(secondes) && secondes > 0
    ? Math.min(secondes * 1000, DELAI_RELANCE_MAX_MS)
    : 1_000;
}

/**
 * Appelle `chemin` sur l'API. Renvoie `null` si la ressource n'existe pas (204/404),
 * le JSON décodé sinon. Lève une erreur explicite pour tout autre statut.
 */
export async function appelerApi<T>(
  api: ApiFranceTravail,
  chemin: string,
  options: { params?: URLSearchParams; corps?: unknown } = {},
): Promise<T | null> {
  const token = await getToken(api.scope);
  const qs = options.params?.toString();
  const url = `${api.base}${chemin}${qs ? `?${qs}` : ""}`;
  const init: RequestInit = {
    method: options.corps === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.corps === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.corps === undefined ? undefined : JSON.stringify(options.corps),
  };

  let res: Response | undefined;
  for (let tentative = 0; tentative < 2; tentative++) {
    await api.limiteur.acquire();
    res = await fetch(url, init);
    if (res.status !== 429 || tentative === 1) break;
    await new Promise((resolve) => setTimeout(resolve, delaiRelance(res!)));
  }

  if (res!.status === 204 || res!.status === 404) return null;
  if (!res!.ok) {
    throw new Error(`${api.nom} KO (${res!.status}) sur ${chemin} : ${(await res!.text()).slice(0, 500)}`);
  }
  return (await res!.json()) as T;
}
