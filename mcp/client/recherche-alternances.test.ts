import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { fusionnerAlternances, rechercherAlternances } from "./recherche-alternances";
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
      [offreFt({ id: "1", intitule: "Alternant Administrateur Systèmes (H/F)", entreprise: "Ville de Nancy" })],
      [offreLba({ id: "L1", intitule: "alternant administrateur systemes h f", entreprise: "VILLE DE NANCY" })],
    );
    expect(r.offres.length).toBe(1);
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
