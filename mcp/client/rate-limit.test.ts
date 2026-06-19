import { test, expect, describe } from "bun:test";
import { RateLimiter, mapAvecConcurrence, type Horloge } from "./rate-limit";

/** Horloge factice : le temps n'avance que lorsqu'on dort. */
function horlogeFactice(): Horloge & { temps: number; dodos: number[] } {
  const etat = {
    temps: 0,
    dodos: [] as number[],
    now() {
      return etat.temps;
    },
    async sleep(ms: number) {
      etat.dodos.push(ms);
      etat.temps += ms;
    },
  };
  return etat;
}

describe("RateLimiter", () => {
  test("laisse passer jusqu'à `max` requêtes sans dormir", async () => {
    const h = horlogeFactice();
    const rl = new RateLimiter(3, 1000, h);
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(h.dodos).toEqual([]);
  });

  test("dort quand le quota est atteint, le temps de libérer un créneau", async () => {
    const h = horlogeFactice();
    const rl = new RateLimiter(2, 1000, h);
    await rl.acquire(); // t=0
    await rl.acquire(); // t=0
    await rl.acquire(); // quota plein → dort 1000ms puis passe
    expect(h.dodos).toEqual([1000]);
    expect(h.temps).toBe(1000);
  });
});

describe("mapAvecConcurrence", () => {
  test("applique la tâche à tous les éléments en préservant l'ordre", async () => {
    const res = await mapAvecConcurrence([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(res).toEqual([10, 20, 30, 40]);
  });

  test("ne dépasse jamais la concurrence demandée", async () => {
    let enCours = 0;
    let maxObserve = 0;
    await mapAvecConcurrence(Array.from({ length: 10 }, (_, i) => i), 3, async (n) => {
      enCours++;
      maxObserve = Math.max(maxObserve, enCours);
      await Bun.sleep(1);
      enCours--;
      return n;
    });
    expect(maxObserve).toBeLessThanOrEqual(3);
  });

  test("liste vide → résultat vide", async () => {
    expect(await mapAvecConcurrence([], 5, async (x) => x)).toEqual([]);
  });
});
