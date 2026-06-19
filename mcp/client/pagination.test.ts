import { test, expect, describe } from "bun:test";
import {
  TAILLE_PAGE_MAX,
  PLAFOND_INDEX,
  calculerDebutsPages,
  construireRange,
  parserTotal,
} from "./pagination";

describe("calculerDebutsPages", () => {
  test("aucune page restante si total tient dans une page", () => {
    expect(calculerDebutsPages(150)).toEqual([]);
    expect(calculerDebutsPages(0)).toEqual([]);
    expect(calculerDebutsPages(1)).toEqual([]);
  });

  test("renvoie les débuts des pages suivantes", () => {
    expect(calculerDebutsPages(151)).toEqual([150]);
    expect(calculerDebutsPages(450)).toEqual([150, 300]);
  });

  test("respecte le plafond d'index de l'API", () => {
    const debuts = calculerDebutsPages(10_000);
    expect(Math.max(...debuts)).toBeLessThan(PLAFOND_INDEX);
    // dernier début + une page ne doit pas dépasser le plafond accessible
    expect(debuts.at(-1)! + TAILLE_PAGE_MAX).toBeLessThanOrEqual(PLAFOND_INDEX + TAILLE_PAGE_MAX);
  });

  test("gère un total négatif", () => {
    expect(calculerDebutsPages(-5)).toEqual([]);
  });
});

describe("construireRange", () => {
  test("borne fin incluse", () => {
    expect(construireRange(0)).toBe("0-149");
    expect(construireRange(150)).toBe("150-299");
    expect(construireRange(0, 50)).toBe("0-49");
  });
});

describe("parserTotal", () => {
  test("extrait le total d'un Content-Range", () => {
    expect(parserTotal("offres 0-149/3456")).toBe(3456);
  });
  test("renvoie 0 si header absent ou invalide", () => {
    expect(parserTotal(null)).toBe(0);
    expect(parserTotal("nimporte quoi")).toBe(0);
    expect(parserTotal("offres 0-149/")).toBe(0);
  });
});
