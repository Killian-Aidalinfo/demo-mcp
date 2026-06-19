/**
 * Authentification OAuth2 (client_credentials) commune aux APIs France Travail.
 *
 * Un token est demandé par *scope* puis mis en cache jusqu'à son expiration
 * (avec une marge de sécurité), pour éviter de redemander un token à chaque appel.
 */
const TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";

// Marge avant expiration : on renouvelle un peu en avance.
const MARGE_EXPIRATION_MS = 30_000;

type EntreeCache = { token: string; expireA: number };
const cache = new Map<string, EntreeCache>();

function lireIdentifiants(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FT_CLIENT_ID;
  const clientSecret = process.env.FT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "FT_CLIENT_ID / FT_CLIENT_SECRET manquants. Renseigne-les dans le fichier .env " +
        "(application créée sur francetravail.io, abonnée aux APIs ciblées).",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Récupère un access_token valide pour le scope demandé (depuis le cache si possible).
 */
export async function getToken(scope: string): Promise<string> {
  const maintenant = Date.now();
  const enCache = cache.get(scope);
  if (enCache && enCache.expireA > maintenant) {
    return enCache.token;
  }

  const { clientId, clientSecret } = lireIdentifiants();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(
      `Échec de l'obtention du token (${res.status}) pour le scope « ${scope} » : ${await res.text()}`,
    );
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(scope, {
    token: json.access_token,
    expireA: maintenant + json.expires_in * 1000 - MARGE_EXPIRATION_MS,
  });
  return json.access_token;
}

/** Vide le cache de tokens (utile pour les tests). */
export function viderCacheTokens(): void {
  cache.clear();
}
