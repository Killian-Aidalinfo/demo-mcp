/**
 * Récupère les données France Travail pour le dashboard et les met en cache
 * dans une base SQLite (bun:sqlite). Génère ensuite `dashboard-data.js`
 * (window.FT_DATA) consommé par index.html.
 *
 *   bun fetch-data.ts            → utilise le cache si présent
 *   bun fetch-data.ts --refresh  → ignore le cache et ré-interroge l'API
 *
 * Données :
 *   - Salaires (FAP, dernier millésime) par région pour 3 profils IT
 *   - Nombre d'offres 2026 par région × métier × niveau de diplôme (bac+3 / bac+5)
 */
import { Database } from "bun:sqlite";

// ─── Config ───────────────────────────────────────────────────────────────────
const CLIENT_ID = Bun.env.FT_CLIENT_ID;
const CLIENT_SECRET = Bun.env.FT_CLIENT_SECRET;
const REFRESH = process.argv.includes("--refresh");

const ANNEE = 2026;
const DATES_2026 = {
  minCreationDate: `${ANNEE}-01-01T00:00:00Z`,
  maxCreationDate: `${ANNEE}-12-31T23:59:59Z`,
};

// 13 régions métropolitaines (code INSEE = code carte GeoJSON)
const REGIONS = [
  { code: "11", nom: "Île-de-France" },
  { code: "24", nom: "Centre-Val de Loire" },
  { code: "27", nom: "Bourgogne-Franche-Comté" },
  { code: "28", nom: "Normandie" },
  { code: "32", nom: "Hauts-de-France" },
  { code: "44", nom: "Grand Est" },
  { code: "52", nom: "Pays de la Loire" },
  { code: "53", nom: "Bretagne" },
  { code: "75", nom: "Nouvelle-Aquitaine" },
  { code: "76", nom: "Occitanie" },
  { code: "84", nom: "Auvergne-Rhône-Alpes" },
  { code: "93", nom: "Provence-Alpes-Côte d'Azur" },
  { code: "94", nom: "Corse" },
];

// DevOps / Ingénieur systèmes = union de codes ROME 4.0 (le filtre codeROME accepte
// plusieurs codes en OU, dédupliqués côté serveur → aucun double comptage).
//   M1827 Ingénieur DevOps · M1879 Ingénieur Cloud · M1860 Architecte cloud
//   M1876 Technicien Cloud · M1802 Expert systèmes & réseaux · M1884 Ing. systèmes/réseaux/sécurité
//   M1839 Architecte systèmes & réseaux   (M1801 « Administrateur SI » exclu → métier admin sys)
const ROME_DEVOPS = "M1827,M1879,M1860,M1876,M1802,M1884,M1839";

// 3 métiers. `fap` = code FAP pour le salaire ; `offres.codeROME` = filtre offres (un ou plusieurs codes).
const METIERS = [
  { id: "dev", label: "Développeur", fap: "M1Z80", offres: { codeROME: "M1805" } },
  { id: "devops", label: "DevOps / Ing. systèmes", fap: "M2Z90", offres: { codeROME: ROME_DEVOPS } },
  { id: "sysadmin", label: "Administrateur systèmes", fap: "M1Z81", offres: { codeROME: "M1810" } },
];

// Niveaux de diplôme (référentiel niveauxFormations)
const DIPLOMES = [
  { id: "bac3", label: "Bac+3 / Bac+4", code: "NV2" },
  { id: "bac5", label: "Bac+5 et plus", code: "NV1" },
];

const STATS_SCOPE = "api_stats-offres-demandes-emploiv1 offresetdemandesemploi";
const OFFRES_SCOPE = "api_offresdemploiv2 o2dsoffre";

// ─── Cache SQLite ───────────────────────────────────────────────────────────────
const db = new Database("data.sqlite");
db.run(`CREATE TABLE IF NOT EXISTS cache (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  recupere_le TEXT NOT NULL
)`);
const lire = db.query<{ valeur: string }, [string]>("SELECT valeur FROM cache WHERE cle = ?");
const ecrire = db.query("INSERT OR REPLACE INTO cache (cle, valeur, recupere_le) VALUES (?, ?, ?)");

// ─── Rate limiter : 10 req/s (fenêtre glissante) ──────────────────────────────────
class RateLimiter {
  private ts: number[] = [];
  constructor(private max: number, private win: number) {}
  async acquire() {
    for (;;) {
      const now = Date.now();
      this.ts = this.ts.filter((t) => now - t < this.win);
      if (this.ts.length < this.max) return void this.ts.push(now);
      await Bun.sleep(this.win - (now - this.ts[0]!));
    }
  }
}
const limiteur = new RateLimiter(10, 1000);

// ─── OAuth ───────────────────────────────────────────────────────────────────────
const tokens = new Map<string, string>();
async function getToken(scope: string): Promise<string> {
  if (tokens.has(scope)) return tokens.get(scope)!;
  const res = await fetch(
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        scope,
      }),
    },
  );
  if (!res.ok) throw new Error(`Token KO (${res.status}) : ${await res.text()}`);
  const j = (await res.json()) as { access_token: string };
  tokens.set(scope, j.access_token);
  return j.access_token;
}

/** Appel HTTP avec cache SQLite + rate limit. Retourne {body, contentRange}. */
async function appel(
  cle: string,
  faire: () => Promise<{ body: string; contentRange: string | null }>,
): Promise<{ body: string; contentRange: string | null }> {
  if (!REFRESH) {
    const hit = lire.get(cle);
    if (hit) return JSON.parse(hit.valeur);
  }
  await limiteur.acquire();
  const data = await faire();
  ecrire.run(cle, JSON.stringify(data), new Date().toISOString());
  return data;
}

// ─── Récupération salaires ─────────────────────────────────────────────────────────
type SalaireMetier = { debutant: number | null; moyen: number | null; experimente: number | null };

async function salairesRegion(regCode: string): Promise<Record<string, SalaireMetier>> {
  const token = await getToken(STATS_SCOPE);
  const url = `https://api.francetravail.io/partenaire/stats-offres-demandes-emploi/v1/indicateur/salaire-rome-fap/REG/${regCode}`;
  const { body } = await appel(`sal:${regCode}`, async () => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`Salaire KO REG ${regCode} (${r.status})`);
    return { body: await r.text(), contentRange: null };
  });

  const data = JSON.parse(body) as {
    valeursParPeriode?: Array<{
      codeActivite: string;
      codePeriode: string;
      salaireValeurMontant?: Array<{ valeurPrincipaleMontant: number }>;
    }>;
  };

  const res: Record<string, SalaireMetier> = {};
  for (const m of METIERS) {
    // on garde la période la plus récente pour le FAP du métier
    const lignes = (data.valeursParPeriode ?? []).filter((v) => v.codeActivite === m.fap);
    const periode = lignes.map((l) => l.codePeriode).sort().at(-1);
    const ligne = lignes.find((l) => l.codePeriode === periode);
    const montants = (ligne?.salaireValeurMontant ?? [])
      .map((s) => s.valeurPrincipaleMontant)
      .filter((n): n is number => typeof n === "number" && n > 0)
      .sort((a, b) => a - b);
    // min = débutant, médiane = moyen, max = expérimenté
    res[m.id] =
      montants.length === 3
        ? { debutant: montants[0]!, moyen: montants[1]!, experimente: montants[2]! }
        : { debutant: montants[0] ?? null, moyen: montants[Math.floor(montants.length / 2)] ?? null, experimente: montants.at(-1) ?? null };
  }
  return res;
}

// ─── Comptage offres ─────────────────────────────────────────────────────────────
async function compterOffres(params: Record<string, string>, _cle?: string): Promise<number> {
  const token = await getToken(OFFRES_SCOPE);
  // clé de cache = signature des paramètres → un changement de filtre invalide automatiquement
  const cle = "off:" + new URLSearchParams(Object.entries(params).sort()).toString();
  const { contentRange } = await appel(cle, async () => {
    const p = new URLSearchParams({ ...params, range: "0-0" });
    const r = await fetch(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status !== 200 && r.status !== 206 && r.status !== 204) {
      throw new Error(`Offres KO (${r.status}) ${cle} : ${await r.text()}`);
    }
    return { body: "", contentRange: r.headers.get("Content-Range") };
  });
  // "offres 0-0/132" → 132 ; si pas de header (204) → 0
  return Number(contentRange?.split("/")[1]) || 0;
}

/** Compte les offres d'un métier pour une région (+ filtres additionnels). */
async function compterMetier(
  regCode: string,
  off: { codeROME: string },
  extra: Record<string, string> = {},
): Promise<number> {
  return compterOffres({ region: regCode, codeROME: off.codeROME, ...DATES_2026, ...extra });
}

// ─── Pipeline ───────────────────────────────────────────────────────────────────
async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("❌ FT_CLIENT_ID / FT_CLIENT_SECRET manquants dans .env");
    process.exit(1);
  }
  console.log(`🚀 Construction du cache (${REFRESH ? "REFRESH forcé" : "cache si dispo"})…\n`);
  const t0 = Date.now();

  const regions: Array<{
    code: string;
    nom: string;
    salaires: Record<string, SalaireMetier>;
    offres: Record<string, { total: number; bac3: number; bac5: number }>;
  }> = [];

  for (const reg of REGIONS) {
    process.stdout.write(`  📍 ${reg.nom.padEnd(28)} `);
    const salaires = await salairesRegion(reg.code);

    const offres: Record<string, { total: number; bac3: number; bac5: number }> = {};
    for (const m of METIERS) {
      const total = await compterMetier(reg.code, m.offres);
      const bac3 = await compterMetier(reg.code, m.offres, { niveauFormation: DIPLOMES[0]!.code });
      const bac5 = await compterMetier(reg.code, m.offres, { niveauFormation: DIPLOMES[1]!.code });
      offres[m.id] = { total, bac3, bac5 };
    }
    regions.push({ code: reg.code, nom: reg.nom, salaires, offres });
    console.log("✓");
  }

  // GeoJSON des régions (déjà téléchargé)
  const geojson = JSON.parse(await Bun.file("regions.geojson").text());

  const payload = {
    annee: ANNEE,
    genereLe: new Date().toISOString(),
    metiers: METIERS.map(({ id, label, fap }) => ({ id, label, fap })),
    diplomes: DIPLOMES,
    regions,
    geojson,
  };

  await Bun.write("dashboard-data.js", `window.FT_DATA = ${JSON.stringify(payload)};\n`);

  const secondes = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Terminé en ${secondes}s — dashboard-data.js généré.`);
  console.log(`   ${regions.length} régions, ${METIERS.length} métiers, ${DIPLOMES.length} niveaux de diplôme.`);

  // petit récap console
  const idf = regions.find((r) => r.code === "11")!;
  console.log("\n   Aperçu Île-de-France :");
  for (const m of METIERS) {
    const s = idf.salaires[m.id]!;
    const o = idf.offres[m.id]!;
    console.log(
      `     • ${m.label.padEnd(24)} salaire moyen ${s.moyen ?? "?"}€ | offres ${o.total} (bac+3:${o.bac3}, bac+5:${o.bac5})`,
    );
  }
}

main();
