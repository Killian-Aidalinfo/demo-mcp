import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  construireParamsAlternance,
  resumerOffreAlternance,
  resumerRecruteur,
  resumerFormationAlternance,
  tronquer,
  rechercherOffresAlternance,
  consulterOffreAlternance,
  rechercherFormationsAlternance,
  type OffreAlternanceLba,
} from "./alternance";

// ─── Données de test (forme OpenAPI JobOfferRead) ─────────────────────────────────
const offreBrute: OffreAlternanceLba = {
  identifier: { id: "abc123", partner_label: "La bonne alternance", partner_job_id: "abc123" },
  workplace: {
    name: "ACME SAS",
    brand: "Acme",
    legal_name: "ACME SOCIETE PAR ACTIONS",
    siret: "12345678900011",
    size: "50-99",
    location: { address: "1 rue de Metz 54000 Nancy", geopoint: { type: "Point", coordinates: [6.18, 48.69] } },
    domain: { opco: "ATLAS", idcc: null, naf: { code: "6202A", label: "Conseil en systèmes" } },
  },
  apply: { url: "https://labonnealternance.apprentissage.beta.gouv.fr/x", phone: null },
  contract: { start: "2026-09-01T00:00:00.000Z", duration: 24, type: ["Apprentissage", "Professionnalisation"], remote: "hybrid" },
  offer: {
    title: "Administrateur systèmes en alternance",
    description: "x".repeat(1000),
    desired_skills: ["Rigueur"],
    rome_codes: ["M1801"],
    publication: { creation: "2026-10-01T00:00:00.000Z", expiration: null },
    target_diploma: { european: "6", label: "Licence, Maîtrise, autres formations (Bac+3 à Bac+4)" },
  },
};

// ─── Fonctions pures ──────────────────────────────────────────────────────────
describe("construireParamsAlternance", () => {
  test("répète les tableaux et ignore les valeurs vides", () => {
    const p = construireParamsAlternance({
      latitude: 48.69,
      longitude: 6.18,
      radius: 30,
      romes: "",
      departements: ["54", "57"],
      rncp: undefined,
    });
    expect(p.getAll("departements")).toEqual(["54", "57"]);
    expect(p.get("latitude")).toBe("48.69");
    expect(p.has("romes")).toBe(false);
    expect(p.has("rncp")).toBe(false);
    expect(p.toString()).toBe("latitude=48.69&longitude=6.18&radius=30&departements=54&departements=57");
  });
});

describe("tronquer", () => {
  test("tronque au-delà de la limite, null si vide", () => {
    expect(tronquer("abcdef", 3)).toBe("abc…");
    expect(tronquer("abc", 3)).toBe("abc");
    expect(tronquer(null, 3)).toBeNull();
  });
});

describe("resumerOffreAlternance", () => {
  test("produit un résumé compact", () => {
    const r = resumerOffreAlternance(offreBrute);
    expect(r).toMatchObject({
      id: "abc123",
      source: "La bonne alternance",
      intitule: "Administrateur systèmes en alternance",
      entreprise: "Acme",
      adresse: "1 rue de Metz 54000 Nancy",
      siret: "12345678900011",
      taille: "50-99",
      typeContrat: "Apprentissage, Professionnalisation",
      dureeMois: 24,
      teletravail: "hybride",
      codesRome: ["M1801"],
      dateExpiration: null,
      telephone: null,
    });
    expect(r.description!.length).toBe(601); // 600 car. + « … »
  });

  test("tolère un objet quasi vide (offre France Travail sans id)", () => {
    const r = resumerOffreAlternance({ identifier: { id: null, partner_label: "France Travail", partner_job_id: "123ABC" } });
    expect(r.id).toBeNull();
    expect(r.idPartenaire).toBe("123ABC");
    expect(r.entreprise).toBeNull();
    expect(r.codesRome).toEqual([]);
    expect(r.typeContrat).toBeNull();
  });

  test("entreprise : brand ?? name ?? legal_name", () => {
    expect(resumerOffreAlternance({ workplace: { brand: null, name: null, legal_name: "LEGAL" } }).entreprise).toBe("LEGAL");
  });
});

describe("resumerRecruteur", () => {
  test("résume un recruteur potentiel", () => {
    expect(
      resumerRecruteur({ identifier: { id: "r1" }, workplace: offreBrute.workplace, apply: { url: "https://u", phone: "0102" } }),
    ).toEqual({
      id: "r1",
      entreprise: "Acme",
      adresse: "1 rue de Metz 54000 Nancy",
      siret: "12345678900011",
      taille: "50-99",
      naf: "6202A Conseil en systèmes",
      url: "https://u",
      telephone: "0102",
    });
  });
});

describe("resumerFormationAlternance", () => {
  test("résume une formation", () => {
    const r = resumerFormationAlternance({
      identifiant: { cle_ministere_educatif: "cle1" },
      formateur: { organisme: { etablissement: { enseigne: "CFA Info" }, unite_legale: { raison_sociale: "CFA SA" } } },
      certification: {
        valeur: {
          identifiant: { cfd: "25031", rncp: "RNCP35475" },
          intitule: { cfd: { long: "BTS SIO", court: "SIO" }, niveau: { cfd: { europeen: "5", libelle: "BTS" } } },
          domaines: { rome: { rncp: [{ code: "M1801", intitule: "Admin SI" }] } },
        },
      },
      lieu: { adresse: { label: "2 av. Foch 57000 Metz" } },
      sessions: [{ debut: "2026-09-01T00:00:00.000Z", fin: "2028-06-30T00:00:00.000Z" }],
      modalite: { entierement_a_distance: false, duree_indicative: 2 },
    });
    expect(r).toMatchObject({
      id: "cle1",
      intitule: "BTS SIO",
      niveau: "BTS",
      rncp: "RNCP35475",
      organisme: "CFA Info",
      adresse: "2 av. Foch 57000 Metz",
      codesRome: ["M1801"],
      aDistance: false,
      dureeIndicative: 2,
    });
    expect(r.sessions).toHaveLength(1);
  });
});

// ─── Appels réseau (fetch mocké) ────────────────────────────────────────────────
const fetchReel = globalThis.fetch;
let derniereUrl = "";
let derniersHeaders: Record<string, string> = {};

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  // @ts-expect-error override de test
  globalThis.fetch = (input: any, init?: RequestInit) => {
    derniereUrl = String(input);
    derniersHeaders = (init?.headers ?? {}) as Record<string, string>;
    return Promise.resolve(handler(String(input), init));
  };
}

beforeEach(() => {
  Bun.env.LBA_API_KEY = "CLE_TEST";
  derniereUrl = "";
  derniersHeaders = {};
});
afterEach(() => {
  globalThis.fetch = fetchReel;
});

describe("rechercherOffresAlternance", () => {
  test("envoie le Bearer, répète departements et renvoie offres/recruteurs/avertissements", async () => {
    mockFetch((url) => {
      if (url.includes("/job/v1/search")) {
        return new Response(
          JSON.stringify({
            jobs: [offreBrute],
            recruiters: [{ identifier: { id: "r1" } }],
            warnings: [{ message: "Source indisponible", code: "FRANCE_TRAVAIL_API_ERROR" }],
          }),
          { status: 200 },
        );
      }
      throw new Error("URL inattendue " + url);
    });

    const r = await rechercherOffresAlternance({ romes: "M1801", departements: ["54", "57"] });
    expect(derniersHeaders.Authorization).toBe("Bearer CLE_TEST");
    expect(derniereUrl).toStartWith("https://api.apprentissage.beta.gouv.fr/api/job/v1/search?");
    expect(new URL(derniereUrl).searchParams.getAll("departements")).toEqual(["54", "57"]);
    expect(r.offres).toHaveLength(1);
    expect(r.recruteurs).toHaveLength(1);
    expect(r.avertissements[0]?.code).toBe("FRANCE_TRAVAIL_API_ERROR");
  });

  test("erreur HTTP → message français avec status et corps", async () => {
    mockFetch(() => new Response('{"message":"Invalid rncp"}', { status: 400 }));
    await expect(rechercherOffresAlternance({ rncp: "X" })).rejects.toThrow(
      /Recherche d'offres d'alternance KO \(400\) : .*Invalid rncp/,
    );
  });

  test("clé absente → erreur explicite, sans appel réseau", async () => {
    delete Bun.env.LBA_API_KEY;
    delete process.env.LBA_API_KEY;
    let appele = false;
    mockFetch(() => {
      appele = true;
      return new Response("{}");
    });
    await expect(rechercherOffresAlternance({})).rejects.toThrow(/LBA_API_KEY manquante.*api\.apprentissage\.beta\.gouv\.fr/);
    expect(appele).toBe(false);
  });
});

describe("consulterOffreAlternance", () => {
  test("renvoie l'offre si trouvée", async () => {
    mockFetch(() => new Response(JSON.stringify(offreBrute), { status: 200 }));
    const o = await consulterOffreAlternance("abc123");
    expect(derniereUrl).toBe("https://api.apprentissage.beta.gouv.fr/api/job/v1/offer/abc123");
    expect(o?.offer?.title).toBe("Administrateur systèmes en alternance");
  });

  test("404 → null", async () => {
    mockFetch(() => new Response(null, { status: 404 }));
    expect(await consulterOffreAlternance("inconnu")).toBeNull();
  });
});

describe("rechercherFormationsAlternance", () => {
  test("lit data + pagination", async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({ data: [{ identifiant: { cle_ministere_educatif: "c1" } }], pagination: { page_count: 3, page_size: 10, page_index: 0 } }),
        { status: 200 },
      ),
    );
    const r = await rechercherFormationsAlternance({ romes: "M1801", page_size: 10 });
    expect(new URL(derniereUrl).pathname).toBe("/api/formation/v1/search");
    expect(new URL(derniereUrl).searchParams.get("page_size")).toBe("10");
    expect(derniersHeaders.Authorization).toBe("Bearer CLE_TEST");
    expect(r.formations).toHaveLength(1);
    expect(r.pagination.page_count).toBe(3);
  });
});
