/**
 * Calcul de pagination pour l'API Offres d'emploi v2.
 *
 * L'API pagine via le paramètre `range=debut-fin` (index inclus), avec :
 *   - max 150 offres par page ;
 *   - un plafond d'index (~3150) : au-delà, l'API refuse la page.
 *
 * Fonctions pures → testables sans réseau.
 */
export const TAILLE_PAGE_MAX = 150;
export const PLAFOND_INDEX = 3150;

/**
 * Renvoie les index de début des pages à récupérer APRÈS la première
 * (la page 0 sert à connaître le total via l'en-tête Content-Range).
 */
export function calculerDebutsPages(
  total: number,
  taillePage: number = TAILLE_PAGE_MAX,
  plafond: number = PLAFOND_INDEX,
): number[] {
  const accessible = Math.min(Math.max(total, 0), plafond);
  const debuts: number[] = [];
  for (let debut = taillePage; debut < accessible; debut += taillePage) {
    debuts.push(debut);
  }
  return debuts;
}

/** Construit la valeur de l'en-tête `range` : "debut-fin" (fin inclus). */
export function construireRange(
  debut: number,
  taillePage: number = TAILLE_PAGE_MAX,
): string {
  return `${debut}-${debut + taillePage - 1}`;
}

/** Parse l'en-tête `Content-Range` ("offres 0-149/3456") → total. */
export function parserTotal(contentRange: string | null): number {
  if (!contentRange) return 0;
  const total = Number(contentRange.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}
