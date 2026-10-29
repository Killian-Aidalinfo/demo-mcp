import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  normaliserCodeRome,
  resumerFicheMetier,
  rechercherMetiers,
  lireMetier,
  lireCompetence,
} from "./rome";
import { json, mockApi, preparerIdentifiants } from "./test-utils";

const fetchReel = globalThis.fetch;
beforeEach(preparerIdentifiants);
afterEach(() => {
  globalThis.fetch = fetchReel;
});

describe("normaliserCodeRome", () => {
  test("met en majuscules et valide le format", () => {
    expect(normaliserCodeRome(" m1801 ")).toBe("M1801");
    expect(() => normaliserCodeRome("1801")).toThrow("Code ROME invalide");
  });
});

describe("resumerFicheMetier", () => {
  test("fusionne métier et fiche, déséchappe la définition", () => {
    const r = resumerFicheMetier(
      {
        code: "M1801",
        libelle: "Administrateur SI",
        definition: "Gère le SI.\\nAssure la sécurité.",
        accesEmploi: "Bac + 5",
        domaineProfessionnel: { code: "M18", libelle: "Systèmes d'information" },
        appellations: [{ code: "10313", libelle: "Administrateur réseau informatique", libelleCourt: "Admin réseau" }],
        competencesMobiliseesPrincipales: [{ code: "1", libelle: "Gérer les droits d'accès" }],
        contextesTravail: [{ code: "2", libelle: "Travail en mode projet" }],
      },
      {
        code: "M1801",
        groupesCompetencesMobilisees: [
          { enjeu: { code: "18", libelle: "Prévention des risques" }, competences: [{ code: "3", libelle: "Gérer les risques cyber" }] },
          { enjeu: { code: "9", libelle: "Vide" }, competences: [] },
        ],
        groupesSavoirs: [{ categorieSavoirs: { code: "2", libelle: "Domaines d'expertise" }, savoirs: [{ code: "4", libelle: "Apache" }] }],
      },
    );
    expect(r.definition).toBe("Gère le SI.\nAssure la sécurité.");
    expect(r.domaine).toBe("M18 Systèmes d'information");
    expect(r.appellations).toEqual(["Admin réseau"]);
    expect(r.competencesParEnjeu).toEqual([{ enjeu: "Prévention des risques", competences: ["Gérer les risques cyber"] }]);
    expect(r.savoirsParCategorie[0]?.savoirs).toEqual(["Apache"]);
  });

  test("tolère une fiche absente", () => {
    expect(resumerFicheMetier(null, { code: "M1801" }).code).toBe("M1801");
  });
});

describe("appels ROME 4.0", () => {
  test("recherche de métier : scope et chemin", async () => {
    const appels = mockApi(() => json({ totalResultats: 1, resultats: [{ code: "M1830", libelle: "Administrateur réseaux - télécoms" }] }));
    const r = await rechercherMetiers("administrateur reseau");
    expect(r.resultats[0]?.code).toBe("M1830");
    expect(appels[0]!.url).toContain("/rome-metiers/v1/metiers/metier/requete?q=administrateur+reseau");
  });

  test("métier inconnu → null", async () => {
    mockApi(() => new Response(null, { status: 404 }));
    expect(await lireMetier("M9999")).toBeNull();
  });

  test("compétence : code OGR numérique exigé", async () => {
    await expect(lireCompetence("abc")).rejects.toThrow("Code compétence invalide");
  });
});
