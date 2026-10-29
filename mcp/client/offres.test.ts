import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  construireParamsRecherche,
  normaliser,
  filtrerReferentiel,
  rechercherOffres,
  consulterOffre,
  getReferentiel,
  chercherDansReferentiel,
  resumerOffre,
  rechercherOffresEnAlternance,
  type EntreeReferentiel,
} from "./offres";
import { viderCacheTokens } from "./auth";

// ─── Fonctions pures ──────────────────────────────────────────────────────────
describe("construireParamsRecherche", () => {
  test("ignore les valeurs vides/indéfinies et stringifie", () => {
    expect(
      construireParamsRecherche({
        motsCles: "dev",
        commune: "",
        distance: 10,
        tempsPlein: true,
      }),
    ).toEqual({ motsCles: "dev", distance: "10", tempsPlein: "true" });
  });
});

describe("normaliser", () => {
  test("insensible casse et accents", () => {
    expect(normaliser("Lyon")).toBe("lyon");
    expect(normaliser("  ÉLÈVE ")).toBe("eleve");
  });
});

describe("filtrerReferentiel", () => {
  const entrees: EntreeReferentiel[] = [
    { code: "69381", libelle: "Lyon 1er Arrondissement" },
    { code: "69382", libelle: "Lyon 2e Arrondissement" },
    { code: "31555", libelle: "Toulouse" },
  ];

  test("filtre par libellé sans tenir compte des accents/casse", () => {
    expect(filtrerReferentiel(entrees, "lyon").length).toBe(2);
    expect(filtrerReferentiel(entrees, "TOULOUSE").map((e) => e.code)).toEqual(["31555"]);
  });

  test("filtre aussi par code", () => {
    expect(filtrerReferentiel(entrees, "31555")[0]?.libelle).toBe("Toulouse");
  });

  test("respecte la limite", () => {
    expect(filtrerReferentiel(entrees, "lyon", 1).length).toBe(1);
  });
});

// ─── Appels réseau (fetch mocké) ────────────────────────────────────────────────
const fetchReel = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  // @ts-expect-error override de test
  globalThis.fetch = (input: any, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init));
}

beforeEach(() => {
  Bun.env.FT_CLIENT_ID = "test-id";
  Bun.env.FT_CLIENT_SECRET = "test-secret";
  viderCacheTokens();
});
afterEach(() => {
  globalThis.fetch = fetchReel;
});

function reponseToken(): Response {
  return new Response(JSON.stringify({ access_token: "TOKEN_X", expires_in: 1499 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("rechercherOffres", () => {
  test("récupère une première page et lit le total via Content-Range", async () => {
    mockFetch((url) => {
      if (url.includes("/access_token")) return reponseToken();
      if (url.includes("/offres/search")) {
        return new Response(JSON.stringify({ resultats: [{ id: "1", intitule: "Dev" }] }), {
          status: 206,
          headers: { "Content-Range": "offres 0-149/1" },
        });
      }
      throw new Error("URL inattendue " + url);
    });

    const r = await rechercherOffres({ motsCles: "dev", commune: "31555" }, 50);
    expect(r.total).toBe(1);
    expect(r.recuperees).toBe(1);
    expect(r.offres[0]?.intitule).toBe("Dev");
  });

  test("204 → aucune offre", async () => {
    mockFetch((url) => {
      if (url.includes("/access_token")) return reponseToken();
      return new Response(null, { status: 204 });
    });
    const r = await rechercherOffres({ motsCles: "introuvable" });
    expect(r.total).toBe(0);
    expect(r.offres).toEqual([]);
  });
});

describe("consulterOffre", () => {
  test("renvoie l'offre si trouvée", async () => {
    mockFetch((url) => {
      if (url.includes("/access_token")) return reponseToken();
      return new Response(JSON.stringify({ id: "42", intitule: "Lead Dev" }), { status: 200 });
    });
    const o = await consulterOffre("42");
    expect(o?.intitule).toBe("Lead Dev");
  });

  test("404 → null", async () => {
    mockFetch((url) => {
      if (url.includes("/access_token")) return reponseToken();
      return new Response(null, { status: 404 });
    });
    expect(await consulterOffre("inconnu")).toBeNull();
  });
});

describe("getReferentiel / chercherDansReferentiel", () => {
  test("chercher filtre le référentiel récupéré", async () => {
    mockFetch((url) => {
      if (url.includes("/access_token")) return reponseToken();
      if (url.includes("/referentiel/communes")) {
        return new Response(
          JSON.stringify([
            { code: "69381", libelle: "Lyon 1er" },
            { code: "31555", libelle: "Toulouse" },
          ]),
          { status: 200 },
        );
      }
      throw new Error("URL inattendue " + url);
    });

    const tous = await getReferentiel("communes");
    expect(tous.length).toBe(2);
    const lyon = await chercherDansReferentiel("communes", "lyon");
    expect(lyon).toEqual([{ code: "69381", libelle: "Lyon 1er" }]);
  });
});

describe("resumerOffre", () => {
  test("garde les champs utiles et construit le lien", () => {
    const r = resumerOffre({
      id: "200ABC",
      intitule: "Alternant administrateur systèmes et réseaux (H/F)",
      entreprise: { nom: "ACME" },
      lieuTravail: { libelle: "54 - NANCY", codePostal: "54000" },
      typeContratLibelle: "Contrat à durée déterminée - 24 Mois",
      natureContrat: "Contrat apprentissage",
      alternance: true,
      formations: [{ niveauLibelle: "Bac+3, Bac+4 ou équivalents", domaineLibelle: "Réseaux" }],
      dateCreation: "2026-10-20T10:00:00.000Z",
    });
    expect(r.alternance).toBe(true);
    expect(r.entreprise).toBe("ACME");
    expect(r.formation).toBe("Bac+3, Bac+4 ou équivalents — Réseaux");
    expect(r.url).toBe("https://candidat.francetravail.fr/offres/recherche/detail/200ABC");
  });

  test("préfère l'URL d'origine d'une offre partenaire", () => {
    expect(resumerOffre({ id: "1", origineOffre: { urlOrigine: "https://partenaire/1" } }).url).toBe(
      "https://partenaire/1",
    );
  });
});

describe("rechercherOffresEnAlternance", () => {
  test("interroge E2 et FS, fusionne sans doublon, plus récentes d'abord", async () => {
    const natures: string[] = [];
    mockFetch((url) => {
      if (url.includes("/access_token")) return reponseToken();
      const nature = new URL(url).searchParams.get("natureContrat") ?? "";
      natures.push(nature);
      const resultats =
        nature === "E2"
          ? [
              { id: "A", dateCreation: "2026-10-01" },
              { id: "B", dateCreation: "2026-10-03" },
            ]
          : [
              { id: "B", dateCreation: "2026-10-03" },
              { id: "C", dateCreation: "2026-10-02" },
            ];
      return new Response(JSON.stringify({ resultats }), {
        status: 206,
        headers: { "Content-Range": "offres 0-1/2" },
      });
    });
    const r = await rechercherOffresEnAlternance({ departement: "54" }, 50);
    expect(natures.sort()).toEqual(["E2", "FS"]);
    expect(r.offres.map((o) => o.id)).toEqual(["B", "C", "A"]);
    expect(r.recuperees).toBe(3);
  });
});
