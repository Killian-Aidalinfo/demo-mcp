import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { construireCorpsPredictionMetiers, predireMetiers, predireCompetences } from "./romeo";
import { json, mockApi, preparerIdentifiants } from "./test-utils";

const fetchReel = globalThis.fetch;
beforeEach(preparerIdentifiants);
afterEach(() => {
  globalThis.fetch = fetchReel;
});

describe("construireCorpsPredictionMetiers", () => {
  test("nomAppelant obligatoire, contexte optionnel, nbResultats borné à 25", () => {
    const c = construireCorpsPredictionMetiers("admin sys", undefined, 40);
    expect(c.options.nomAppelant).toBe("mcp-france-travail");
    expect(c.options.nbResultats).toBe(25);
    expect(c.appellations[0]).toEqual({ intitule: "admin sys", identifiant: "1" });
    expect(construireCorpsPredictionMetiers("x", "alternance").appellations[0]).toHaveProperty("contexte", "alternance");
  });
});

describe("predireMetiers", () => {
  test("POST /predictionMetiers, meilleur score d'abord", async () => {
    const appels = mockApi(() =>
      json([
        {
          identifiant: "1",
          metiersRome: [
            { codeRome: "M1802", libelleRome: "Expert SR", codeAppellation: "15894", libelleAppellation: "Ingénieur", scorePrediction: 0.7 },
            { codeRome: "M1801", libelleRome: "Admin SI", codeAppellation: "489089", libelleAppellation: "Admin SR", scorePrediction: 0.9 },
          ],
        },
      ]),
    );
    const r = await predireMetiers("admin sys et réseau");
    expect(r.map((m) => m.codeRome)).toEqual(["M1801", "M1802"]);
    expect(appels[0]!.url).toEndWith("/romeo/v2/predictionMetiers");
    expect(appels[0]!.init?.method).toBe("POST");
  });
});

describe("predireCompetences", () => {
  test("lit competencesRome", async () => {
    mockApi(() =>
      json([{ competencesRome: [{ codeCompetence: "483972", libelleCompetence: "Configurer des pare-feu", scorePrediction: 0.87 }] }]),
    );
    expect((await predireCompetences("pare-feu"))[0]?.codeCompetence).toBe("483972");
  });
});
