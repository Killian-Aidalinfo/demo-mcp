import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { SCOPE_STATS, statistiquesMarche, listerTerritoires, resumerSalaires, salairesMetier } from "./stats";
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

describe("resumerSalaires", () => {
  test("une ligne par FAP, montants SAL1/SAL2/SAL3", () => {
    const r = resumerSalaires({
      valeursParPeriode: [
        {
          codeActivite: "M1Z81",
          libActivite: "Techniciens de production en informatique",
          codePeriode: "2022",
          salaireValeurMontant: [
            { codeNomenclature: "SAL1", valeurPrincipaleMontant: 2459 },
            { codeNomenclature: "SAL2", valeurPrincipaleMontant: 3235 },
            { codeNomenclature: "SAL3", valeurPrincipaleMontant: 2888 },
          ],
        },
      ],
    });
    expect(r).toEqual([
      { codeFap: "M1Z81", libelle: "Techniciens de production en informatique", periode: "2022", moins35ans: 2459, plus35ans: 3235, tousAges: 2888 },
    ]);
  });

  test("réponse vide ou montant manquant", () => {
    expect(resumerSalaires(null)).toEqual([]);
    expect(resumerSalaires({ valeursParPeriode: [{ codeActivite: "X", salaireValeurMontant: [] }] })[0]?.tousAges).toBeNull();
  });
});

describe("salairesMetier", () => {
  test("GET salaire-rome-fap/{type}/{code}?codeRome=", async () => {
    let url = "";
    // @ts-expect-error override de test
    globalThis.fetch = async (u: any) => {
      if (String(u).includes("/access_token")) {
        return new Response(JSON.stringify({ access_token: "T", expires_in: 1499 }), { status: 200 });
      }
      url = String(u);
      return new Response(JSON.stringify({ libIndicateur: "SAL_3", valeursParPeriode: [] }), { status: 200 });
    };
    const r = await salairesMetier("m1801", "DEP", "54");
    expect(url).toEndWith("/indicateur/salaire-rome-fap/DEP/54?codeRome=M1801");
    expect(r.libIndicateur).toBe("SAL_3");
  });
});
