import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { getToken, viderCacheTokens } from "./auth";

const fetchReel = globalThis.fetch;

beforeEach(() => {
  Bun.env.FT_CLIENT_ID = "test-id";
  Bun.env.FT_CLIENT_SECRET = "test-secret";
  viderCacheTokens();
});
afterEach(() => {
  globalThis.fetch = fetchReel;
});

describe("getToken", () => {
  test("met le token en cache : un seul appel réseau pour le même scope", async () => {
    let appels = 0;
    // @ts-expect-error override de test
    globalThis.fetch = async () => {
      appels++;
      return new Response(JSON.stringify({ access_token: "ABC", expires_in: 1499 }), {
        status: 200,
      });
    };

    const t1 = await getToken("scope-a");
    const t2 = await getToken("scope-a");
    expect(t1).toBe("ABC");
    expect(t2).toBe("ABC");
    expect(appels).toBe(1);
  });

  test("scopes différents → tokens demandés séparément", async () => {
    let appels = 0;
    // @ts-expect-error override de test
    globalThis.fetch = async () => {
      appels++;
      return new Response(JSON.stringify({ access_token: "T" + appels, expires_in: 1499 }), {
        status: 200,
      });
    };
    await getToken("scope-a");
    await getToken("scope-b");
    expect(appels).toBe(2);
  });

  test("erreur explicite si identifiants manquants", async () => {
    delete Bun.env.FT_CLIENT_ID;
    delete Bun.env.FT_CLIENT_SECRET;
    expect(getToken("scope-a")).rejects.toThrow(/FT_CLIENT_ID/);
  });

  test("propage une erreur HTTP du serveur de token", async () => {
    // @ts-expect-error override de test
    globalThis.fetch = async () => new Response("nope", { status: 401 });
    expect(getToken("scope-a")).rejects.toThrow(/401/);
  });
});
