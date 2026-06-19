/**
 * Limitation de débit (fenêtre glissante) + exécution concurrente bornée.
 *
 * Les APIs France Travail plafonnent à ~10 appels/seconde. On respecte ce quota
 * avant chaque appel réseau, et on borne le nombre de requêtes en vol.
 *
 * `now`/`sleep` sont injectables pour rendre la classe testable sans timers réels.
 */
export type Horloge = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const horlogeReelle: Horloge = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly horloge: Horloge = horlogeReelle,
  ) {}

  /** Bloque tant que le quota (max req / fenêtre) est atteint. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = this.horloge.now();
      // On ne garde que les requêtes encore dans la fenêtre.
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.max) {
        this.timestamps.push(now);
        return;
      }
      // Quota plein : on attend que la plus ancienne sorte de la fenêtre.
      const attente = this.windowMs - (now - this.timestamps[0]!);
      await this.horloge.sleep(attente);
    }
  }
}

/** Exécute `tache` sur chaque élément avec une concurrence bornée. */
export async function mapAvecConcurrence<T, R>(
  items: T[],
  concurrence: number,
  tache: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const resultats = new Array<R>(items.length);
  let curseur = 0;

  const worker = async () => {
    for (;;) {
      const i = curseur++;
      if (i >= items.length) return;
      resultats[i] = await tache(items[i]!, i);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrence, items.length) }, worker),
  );
  return resultats;
}
