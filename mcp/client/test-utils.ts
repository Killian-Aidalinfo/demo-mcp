/**
 * Utilitaires de test partagés : fetch mocké qui répond au token OAuth2,
 * puis délègue les appels API au gestionnaire du test.
 */
import { viderCacheTokens } from "./auth";

export type AppelCapture = { url: string; init?: RequestInit };

export function preparerIdentifiants(): void {
  Bun.env.FT_CLIENT_ID = "test-id";
  Bun.env.FT_CLIENT_SECRET = "test-secret";
  viderCacheTokens();
}

export function mockApi(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): AppelCapture[] {
  const appels: AppelCapture[] = [];
  // @ts-expect-error override de test
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/access_token")) {
      return new Response(JSON.stringify({ access_token: "T", expires_in: 1499 }), { status: 200 });
    }
    appels.push({ url, init });
    return handler(url, init);
  };
  return appels;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}
