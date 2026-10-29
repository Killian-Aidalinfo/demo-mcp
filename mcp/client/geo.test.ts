import { test, expect, describe, afterEach } from "bun:test";
import { convertirCommune, construireParamsGeo, localiserCommunes } from "./geo";

const fetchReel = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchReel;
});

function mockFetch(handler: (url: string) => Response) {
  // @ts-expect-error override de test
  globalThis.fetch = (input: any) => Promise.resolve(handler(String(input)));
}

const NANCY = {
  code: "54395",
  nom: "Nancy",
  codesPostaux: ["54000", "54100"],
  codeDepartement: "54",
  population: 103671,
  centre: { type: "Point", coordinates: [6.1734, 48.6881] as [number, number] },
};

describe("convertirCommune", () => {
  test("GeoJSON [lon, lat] → latitude / longitude", () => {
    const c = convertirCommune(NANCY);
    expect(c.codeInsee).toBe("54395");
    expect(c.departement).toBe("54");
    expect(c.latitude).toBe(48.6881);
    expect(c.longitude).toBe(6.1734);
  });
});

describe("construireParamsGeo", () => {
  test("nom → recherche par nom boostée par population", () => {
    const p = construireParamsGeo("Nancy", 5);
    expect(p.get("nom")).toBe("Nancy");
    expect(p.get("boost")).toBe("population");
    expect(p.get("limit")).toBe("5");
  });

  test("5 chiffres → code postal", () => {
    expect(construireParamsGeo("54000", 5).get("codePostal")).toBe("54000");
  });
});

describe("localiserCommunes", () => {
  test("code INSEE → ressource directe", async () => {
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      return new Response(JSON.stringify(NANCY), { status: 200 });
    });
    const r = await localiserCommunes("54395");
    expect(r[0]?.nom).toBe("Nancy");
    expect(urls[0]).toContain("/communes/54395");
  });

  test("code postal (pas un INSEE) → 404 puis recherche par code postal", async () => {
    mockFetch((url) => {
      if (url.includes("/communes/54000")) return new Response("{}", { status: 404 });
      if (url.includes("codePostal=54000")) return new Response(JSON.stringify([NANCY]), { status: 200 });
      throw new Error("URL inattendue " + url);
    });
    expect((await localiserCommunes("54000"))[0]?.codeInsee).toBe("54395");
  });

  test("erreur HTTP → message explicite", async () => {
    mockFetch(() => new Response("boom", { status: 500 }));
    await expect(localiserCommunes("Nancy")).rejects.toThrow("500");
  });
});
