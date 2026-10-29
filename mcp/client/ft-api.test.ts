import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { appelerApi, type ApiFranceTravail } from "./ft-api";
import { RateLimiter } from "./rate-limit";
import { json, mockApi, preparerIdentifiants } from "./test-utils";

const fetchReel = globalThis.fetch;
beforeEach(preparerIdentifiants);
afterEach(() => {
  globalThis.fetch = fetchReel;
});

const API: ApiFranceTravail = {
  nom: "API test",
  scope: "api_testv1",
  base: "https://api.example/partenaire/test/v1",
  limiteur: new RateLimiter(100, 1000),
};

describe("appelerApi", () => {
  test("GET avec query string et Accept JSON", async () => {
    const appels = mockApi(() => json({ ok: true }));
    expect(await appelerApi<unknown>(API, "/x", { params: new URLSearchParams({ q: "a b" }) })).toEqual({ ok: true });
    expect(appels[0]!.url).toBe("https://api.example/partenaire/test/v1/x?q=a+b");
    expect(appels[0]!.init?.method).toBe("GET");
    expect((appels[0]!.init?.headers as Record<string, string>).Accept).toBe("application/json");
  });

  test("POST JSON quand un corps est fourni", async () => {
    const appels = mockApi(() => json([]));
    await appelerApi(API, "/y", { corps: { a: 1 } });
    expect(appels[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(appels[0]!.init?.body))).toEqual({ a: 1 });
  });

  test("relance une fois après un 429", async () => {
    let n = 0;
    const appels = mockApi(() =>
      ++n === 1 ? new Response("trop", { status: 429, headers: { "Retry-After": "0.01" } }) : json({ ok: 2 }),
    );
    expect(await appelerApi<unknown>(API, "/z")).toEqual({ ok: 2 });
    expect(appels).toHaveLength(2);
  });

  test("404 → null ; autre erreur → message explicite", async () => {
    mockApi(() => new Response("absent", { status: 404 }));
    expect(await appelerApi(API, "/absent")).toBeNull();
    mockApi(() => new Response("refusé", { status: 403 }));
    await expect(appelerApi(API, "/interdit")).rejects.toThrow("API test KO (403) sur /interdit");
  });
});
