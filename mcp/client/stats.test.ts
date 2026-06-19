import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { SCOPE_STATS, statistiquesMarche, listerTerritoires } from "./stats";
import { viderCacheTokens } from "./auth";

const fetchReel = globalThis.fetch;

beforeEach(() => {
  Bun.env.FT_CLIENT_ID = "test-id";
  Bun.env.FT_CLIENT_SECRET = "test-secret";
  viderCacheTokens();
});
afterEach(() => {
  globalThis.fetch = fetchReel;
});

describe("SCOPE_STATS", () => {
  test("contient bien le double scope obligatoire", () => {
    expect(SCOPE_STATS).toContain("api_stats-offres-demandes-emploiv1");
    expect(SCOPE_STATS).toContain("offresetdemandesemploi");
  });
});

describe("statistiquesMarche", () => {
  test("POST avec Accept: application/json et renvoie les valeurs", async () => {
    const cap: { accept?: string; methode?: string; corps?: any } = {};
    // @ts-expect-error override de test
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      if (String(url).includes("/access_token")) {
        return new Response(JSON.stringify({ access_token: "T", expires_in: 1499 }), { status: 200 });
      }
      cap.accept = (init?.headers as Record<string, string>)?.["Accept"];
      cap.methode = init?.method;
      cap.corps = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          codeIndicateur: "OFF_1",
          libIndicateur: "Offres collectées",
          listeValeursParPeriode: [{ valeurPrincipaleNombre: 1234 }],
        }),
        { status: 200 },
      );
    };

    const r = await statistiquesMarche("stat-offres", {
      codeTypeTerritoire: "REG",
      codeTerritoire: "84",
      codeTypeNomenclature: "ORIGINEOFF",
      dernierePeriode: true,
    });

    expect(cap.methode).toBe("POST");
    expect(cap.accept).toBe("application/json");
    expect(cap.corps.codeTerritoire).toBe("84");
    expect(r.listeValeursParPeriode?.[0]?.valeurPrincipaleNombre).toBe(1234);
  });

  test("erreur HTTP propagée avec le payload", async () => {
    // @ts-expect-error override de test
    globalThis.fetch = async (url: any) => {
      if (String(url).includes("/access_token")) {
        return new Response(JSON.stringify({ access_token: "T", expires_in: 1499 }), { status: 200 });
      }
      return new Response("forbidden", { status: 403 });
    };
    expect(
      statistiquesMarche("stat-offres", { codeTypeTerritoire: "REG", codeTerritoire: "84" }),
    ).rejects.toThrow(/403/);
  });
});

describe("listerTerritoires", () => {
  test("accepte une réponse tableau", async () => {
    // @ts-expect-error override de test
    globalThis.fetch = async (url: any) => {
      if (String(url).includes("/access_token")) {
        return new Response(JSON.stringify({ access_token: "T", expires_in: 1499 }), { status: 200 });
      }
      return new Response(JSON.stringify([{ code: "84", libelle: "Auvergne-Rhône-Alpes" }]), {
        status: 200,
      });
    };
    const t = await listerTerritoires("REG");
    expect(t[0]?.code).toBe("84");
  });
});
