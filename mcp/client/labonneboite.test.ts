import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  SCOPE_LBB,
  construireParamsLbb,
  dedoublonnerEntreprises,
  rechercherEntreprisesQuiRecrutent,
  resumerEntrepriseLbb,
  type EntrepriseLbb,
} from "./labonneboite";
import { json, mockApi, preparerIdentifiants } from "./test-utils";

const fetchReel = globalThis.fetch;
beforeEach(preparerIdentifiants);
afterEach(() => {
  globalThis.fetch = fetchReel;
});

const TRUSTTEAM: EntrepriseLbb = {
  rome: "M1801",
  siret: "51903725300043",
  company_name: "TRUSTTEAM",
  office_name: "DSOFT",
  headcount_min: 20,
  headcount_max: 49,
  naf: "4651Z",
  naf_label: "Commerce de gros d'ordinateurs",
  city: "Maxéville",
  postcode: "54320",
  hiring_potential: 3.548963376,
  is_high_potential: false,
};

describe("SCOPE_LBB", () => {
  test("scope à trois segments", () => {
    expect(SCOPE_LBB).toBe("api_labonneboitev2 search office");
  });
});

describe("construireParamsLbb", () => {
  test("répète rome, centre sur la commune, trie par potentiel", () => {
    const p = construireParamsLbb({ romes: ["m1801", "M1830"], codeInsee: "54395", distanceKm: 30 });
    expect(p.getAll("rome")).toEqual(["M1801", "M1830"]);
    expect(p.get("citycode")).toBe("54395");
    expect(p.get("distance")).toBe("30");
    expect(p.get("sort_by")).toBe("hiring_potential");
    expect(p.get("page_size")).toBe("20");
  });

  test("GPS prioritaire sur la commune, distance et taille de page bornées", () => {
    const p = construireParamsLbb({
      romes: ["M1801"],
      codeInsee: "54395",
      latitude: 48.69,
      longitude: 6.18,
      distanceKm: 500,
      parPage: 250,
    });
    expect(p.get("latitude")).toBe("48.69");
    expect(p.has("citycode")).toBe(false);
    expect(p.get("distance")).toBe("199");
    expect(p.get("page_size")).toBe("100");
  });

  test("refuse une recherche sans code ROME", () => {
    expect(() => construireParamsLbb({ romes: [] })).toThrow("ROME");
  });
});

describe("resumerEntrepriseLbb", () => {
  test("nom + enseigne, effectif et potentiel arrondi", () => {
    const r = resumerEntrepriseLbb(TRUSTTEAM);
    expect(r.entreprise).toBe("TRUSTTEAM (DSOFT)");
    expect(r.effectif).toBe("20 à 49 salariés");
    expect(r.potentielEmbauche).toBe(3.55);
    expect(r.naf).toBe("4651Z Commerce de gros d'ordinateurs");
  });

  test("effectif inconnu (0-0) → null", () => {
    expect(resumerEntrepriseLbb({ ...TRUSTTEAM, headcount_min: 0, headcount_max: 0 }).effectif).toBeNull();
  });
});

describe("rechercherEntreprisesQuiRecrutent", () => {
  test("GET /recherche authentifié, renvoie total et entreprises", async () => {
    const appels = mockApi(() => json({ hits: 1, items: [TRUSTTEAM] }));
    const r = await rechercherEntreprisesQuiRecrutent({ romes: ["M1801"], codeInsee: "54395" });
    expect(r.total).toBe(1);
    expect(r.entreprises[0]?.siret).toBe("51903725300043");
    expect(appels[0]!.url).toContain("/labonneboite/v2/recherche?rome=M1801");
    expect((appels[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer T");
  });

  test("204 → aucune entreprise", async () => {
    mockApi(() => new Response(null, { status: 204 }));
    expect(await rechercherEntreprisesQuiRecrutent({ romes: ["M1801"] })).toEqual({ total: 0, entreprises: [] });
  });
});

describe("dedoublonnerEntreprises", () => {
  test("une ligne par SIRET (meilleur potentiel), tri décroissant", () => {
    const base = resumerEntrepriseLbb(TRUSTTEAM);
    const r = dedoublonnerEntreprises([
      { ...base, siret: "A", potentielEmbauche: 2.6 },
      { ...base, siret: "B", potentielEmbauche: 6.95 },
      { ...base, siret: "A", potentielEmbauche: 10.7 },
      { ...base, siret: null, potentielEmbauche: null },
    ]);
    expect(r.map((e) => [e.siret, e.potentielEmbauche])).toEqual([
      ["A", 10.7],
      ["B", 6.95],
      [null, null],
    ]);
  });
});
