import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { fusionnerAlternances, fusionnerRecruteurs, rechercherAlternances } from "./recherche-alternances";
import type { OffreResumee } from "./offres";
import type { ResumeOffreAlternance } from "./alternance";
import { viderCacheTokens } from "./auth";

function offreFt(p: Partial<OffreResumee>): OffreResumee {
  return {
    id: null, intitule: null, entreprise: null, lieu: null, codePostal: null, contrat: null,
    natureContrat: null, alternance: true, codeRome: null, experience: null, formation: null,
    salaire: null, datePublication: null, url: null, ...p,
  };
}

function offreLba(p: Partial<ResumeOffreAlternance>): ResumeOffreAlternance {
  return {
    id: null, source: null, idPartenaire: null, intitule: null, entreprise: null, adresse: null,
    siret: null, taille: null, typeContrat: null, debut: null, dureeMois: null, teletravail: null,
    niveauVise: null, codesRome: [], datePublication: null, dateExpiration: null, url: null,
    telephone: null, description: null, ...p,
  };
}

describe("fusionnerAlternances", () => {
  test("retire une offre LBA qui reprend une offre France Travail (id partenaire)", () => {
    const r = fusionnerAlternances(
      [offreFt({ id: "200X", intitule: "Admin réseau", entreprise: "ACME" })],
      [offreLba({ source: "France Travail", idPartenaire: "200X", intitule: "Autre libellé", entreprise: "ACME SAS" })],
    );
    expect(r.offres.length).toBe(1);
    expect(r.offres[0]?.source).toBe("France Travail");
    expect(r.doublonsRetires).toBe(1);
  });

  test("retire un doublon approché (même intitulé + entreprise, casse/accents/ponctuation)", () => {
    const r = fusionnerAlternances(
      [offreFt({ id: "1", intitule: "Alternant Administrateur Systèmes (H/F)", entreprise: "Ville de Nancy", codePostal: "54000" })],
      [offreLba({ id: "L1", intitule: "alternant administrateur systemes h f", entreprise: "VILLE DE NANCY", adresse: "1 place Stanislas 54000 NANCY" })],
    );
    expect(r.offres.length).toBe(1);
  });

  test("garde la même annonce publiée dans des communes différentes", () => {
    const r = fusionnerAlternances(
      [
        offreFt({ id: "1", intitule: "Commercial en alternance", entreprise: "Pigier", codePostal: "54520" }),
        offreFt({ id: "2", intitule: "Commercial en alternance", entreprise: "Pigier", codePostal: "54300" }),
      ],
      [offreLba({ id: "L1", intitule: "Commercial en alternance", entreprise: "Pigier", adresse: "54000 NANCY" })],
    );
    expect(r.offres.length).toBe(3);
    expect(r.doublonsRetires).toBe(0);
  });

  test("garde les offres distinctes, plus récentes d'abord, avec le bon tool de détail", () => {
    const r = fusionnerAlternances(
      [offreFt({ id: "1", intitule: "A", entreprise: "E1", datePublication: "2026-10-01" })],
      [offreLba({ id: "L2", source: "Hellowork", intitule: "B", entreprise: "E2", datePublication: "2026-10-05" })],
    );
    expect(r.offres.map((o) => o.id)).toEqual(["L2", "1"]);
    expect(r.offres[0]?.outilDetail).toBe("consulter_offre_alternance");
    expect(r.offres[0]?.source).toBe("La bonne alternance (Hellowork)");
    expect(r.offres[1]?.outilDetail).toBe("consulter_offre");
  });

  test("une offre sans identifiant n'a pas de tool de détail", () => {
    const r = fusionnerAlternances([], [offreLba({ intitule: "C", entreprise: "E3", url: "https://x" })]);
    expect(r.offres[0]?.outilDetail).toBeNull();
  });
});

// ─── Orchestration (fetch mocké) ───────────────────────────────────────────────
const fetchReel = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchReel;
});
beforeEach(() => {
  viderCacheTokens();
});

const NANCY = {
  code: "54395", nom: "Nancy", codesPostaux: ["54000"], codeDepartement: "54",
  centre: { type: "Point", coordinates: [6.1734, 48.6881] },
};

describe("rechercherAlternances", () => {
  test("une source sans identifiants n'empêche pas l'autre de répondre", async () => {
    delete Bun.env.FT_CLIENT_ID;
    delete Bun.env.FT_CLIENT_SECRET;
    Bun.env.LBA_API_KEY = "cle-test";
    const urls: string[] = [];
    // @ts-expect-error override de test
    globalThis.fetch = (input: any) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("geo.api.gouv.fr")) return Promise.resolve(new Response(JSON.stringify([NANCY])));
      if (url.includes("/job/v1/search")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jobs: [{ identifier: { id: "L1", partner_label: "La bonne alternance" }, offer: { title: "Admin sys" }, workplace: { name: "ACME" }, apply: { url: "https://lba/L1" } }],
              recruiters: [],
              warnings: [],
            }),
          ),
        );
      }
      throw new Error("URL inattendue " + url);
    };

    const r = await rechercherAlternances({ ville: "Nancy", rayonKm: 20, romes: "M1801" });
    expect(r.commune.codeInsee).toBe("54395");
    expect(r.parSource.franceTravail).toBeNull();
    expect(r.parSource.laBonneAlternance).toBe(1);
    expect(r.offres[0]?.intitule).toBe("Admin sys");
    expect(r.avertissements[0]).toContain("France Travail indisponible");
    const lba = new URL(urls.find((u) => u.includes("/job/v1/search"))!);
    expect(lba.searchParams.get("latitude")).toBe("48.6881");
    expect(lba.searchParams.get("radius")).toBe("20");
    expect(lba.searchParams.get("romes")).toBe("M1801");
  });
});

describe("fusionnerRecruteurs", () => {
  test("La Bonne Boîte d'abord, recruteurs LBA ajoutés sauf SIRET déjà vu", () => {
    const r = fusionnerRecruteurs(
      [{ siret: "111", entreprise: "TRUSTTEAM", ville: "Maxéville", codePostal: "54320", effectif: "20 à 49 salariés", naf: null, codeRome: "M1801", potentielEmbauche: 3.55, fortPotentiel: false }],
      [
        { id: "a", entreprise: "TRUSTTEAM bis", adresse: "x", siret: "111", taille: null, naf: null, url: null, telephone: null },
        { id: "b", entreprise: "ACME", adresse: "Nancy", siret: "222", taille: null, naf: null, url: "https://lba/b", telephone: null },
      ],
    );
    expect(r.map((e) => [e.source, e.siret])).toEqual([
      ["La Bonne Boîte", "111"],
      ["La bonne alternance", "222"],
    ]);
    expect(r[0]?.adresse).toBe("54320 Maxéville");
    expect(r[0]?.potentielEmbauche).toBe(3.55);
    expect(r[1]?.potentielEmbauche).toBeNull();
  });
});

describe("rechercherAlternances — recruteurs", () => {
  test("inclureRecruteurs interroge La Bonne Boîte avec les codes ROME et la commune", async () => {
    Bun.env.FT_CLIENT_ID = "test-id";
    Bun.env.FT_CLIENT_SECRET = "test-secret";
    Bun.env.LBA_API_KEY = "cle-test";
    viderCacheTokens();
    const urls: string[] = [];
    // @ts-expect-error override de test
    globalThis.fetch = (input: any) => {
      const url = String(input);
      urls.push(url);
      const rep = (d: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(d), { status }));
      if (url.includes("geo.api.gouv.fr")) return rep([NANCY]);
      if (url.includes("/access_token")) return rep({ access_token: "T", expires_in: 1499 });
      if (url.includes("/offresdemploi/")) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/job/v1/search")) {
        return rep({ jobs: [], recruiters: [{ identifier: { id: "R1" }, workplace: { name: "ACME", siret: "222" } }], warnings: [] });
      }
      if (url.includes("/labonneboite/v2/recherche")) {
        return rep({ hits: 1, items: [{ siret: "111", company_name: "TRUSTTEAM", hiring_potential: 3.5 }] });
      }
      throw new Error("URL inattendue " + url);
    };

    const r = await rechercherAlternances({ ville: "Nancy", romes: "M1801,M1830", inclureRecruteurs: true });
    expect(r.recruteurs.map((e) => e.siret)).toEqual(["111", "222"]);
    const lbb = new URL(urls.find((u) => u.includes("/labonneboite/"))!);
    expect(lbb.searchParams.getAll("rome")).toEqual(["M1801", "M1830"]);
    expect(lbb.searchParams.get("citycode")).toBe("54395");
    expect(lbb.searchParams.get("distance")).toBe("30");
  });

  test("sans codes ROME : pas d'appel La Bonne Boîte, avertissement explicite", async () => {
    Bun.env.LBA_API_KEY = "cle-test";
    delete Bun.env.FT_CLIENT_ID;
    const urls: string[] = [];
    // @ts-expect-error override de test
    globalThis.fetch = (input: any) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("geo.api.gouv.fr")) return Promise.resolve(new Response(JSON.stringify([NANCY])));
      return Promise.resolve(new Response(JSON.stringify({ jobs: [], recruiters: [], warnings: [] })));
    };
    const r = await rechercherAlternances({ ville: "Nancy", inclureRecruteurs: true });
    expect(urls.some((u) => u.includes("/labonneboite/"))).toBe(false);
    expect(r.avertissements.some((a) => a.includes("préciser `romes`"))).toBe(true);
  });
});

