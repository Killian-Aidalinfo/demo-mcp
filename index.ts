/**
 * Démo d'appels aux APIs France Travail (francetravail.io)
 *
 *  - Offres d'emploi v2   : https://francetravail.io/produits-partages/catalogue/offres-emploi/documentation
 *  - Marché du travail    : https://francetravail.io/produits-partages/catalogue/marche-travail/documentation
 *
 * Les deux APIs utilisent OAuth2 (client_credentials).
 * Crée une appli sur francetravail.io, récupère ton client_id / client_secret
 * et abonne-toi aux deux APIs, puis renseigne le .env :
 *
 *   FT_CLIENT_ID=...
 *   FT_CLIENT_SECRET=...
 *
 * Bun charge automatiquement le .env (pas besoin de dotenv).
 */

const CLIENT_ID = Bun.env.FT_CLIENT_ID;
const CLIENT_SECRET = Bun.env.FT_CLIENT_SECRET;

const TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";

// ─── Petits helpers d'affichage ──────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function titre(emoji: string, texte: string) {
  console.log(
    `\n${c.bold}${c.cyan}${"─".repeat(60)}${c.reset}\n` +
      `${c.bold}${emoji}  ${texte}${c.reset}\n` +
      `${c.bold}${c.cyan}${"─".repeat(60)}${c.reset}`,
  );
}

function ligne(label: string, valeur: unknown) {
  console.log(`  ${c.dim}${label.padEnd(22)}${c.reset} ${c.green}${valeur}${c.reset}`);
}

// ─── OAuth2 : récupération d'un token pour un scope donné ─────────────────────
async function getToken(scope: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    scope,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token KO (${res.status}) pour scope « ${scope} » : ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  console.log(
    `  ${c.dim}🔑 Token obtenu (scope: ${scope}) — expire dans ${json.expires_in}s${c.reset}`,
  );
  return json.access_token;
}

// ─── Rate limiter : N requêtes max par fenêtre glissante ──────────────────────
class RateLimiter {
  private timestamps: number[] = [];
  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** Bloque tant que le quota (max req / fenêtre) est atteint. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      // on ne garde que les requêtes encore dans la fenêtre
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.max) {
        this.timestamps.push(now);
        return;
      }
      // quota plein : on attend que la plus ancienne sorte de la fenêtre
      const attente = this.windowMs - (now - this.timestamps[0]!);
      await Bun.sleep(attente);
    }
  }
}

/** Exécute `tache` sur chaque élément avec une concurrence bornée. */
async function mapAvecConcurrence<T, R>(
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

  await Promise.all(Array.from({ length: Math.min(concurrence, items.length) }, worker));
  return resultats;
}

type Offre = {
  intitule: string;
  lieuTravail?: { libelle?: string };
  entreprise?: { nom?: string };
  typeContratLibelle?: string;
  dateCreation?: string;
};

const TAILLE_PAGE = 150; // maximum autorisé par l'API
const limiteur = new RateLimiter(10, 1000); // 10 requêtes / seconde

/** Récupère une page d'offres [debut, debut+TAILLE_PAGE-1]. */
async function fetchPageOffres(
  token: string,
  baseParams: Record<string, string>,
  debut: number,
): Promise<{ offres: Offre[]; total: number; status: number }> {
  const fin = debut + TAILLE_PAGE - 1;
  const params = new URLSearchParams({ ...baseParams, range: `${debut}-${fin}` });
  const url = `https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`;

  await limiteur.acquire(); // ← on respecte le quota avant chaque appel
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  // 200 = tout tient dans la page, 206 = page partielle (il en reste)
  if (res.status !== 200 && res.status !== 206) {
    throw new Error(`Offres KO (${res.status}) range ${debut}-${fin} : ${await res.text()}`);
  }

  // Header type : "offres 0-149/3456"
  const contentRange = res.headers.get("Content-Range") ?? "";
  const total = Number(contentRange.split("/")[1]) || 0;

  const data = (await res.json()) as { resultats?: Offre[] };
  return { offres: data.resultats ?? [], total, status: res.status };
}

// ─── 1) API Offres d'emploi v2 — pagination complète ──────────────────────────
async function testOffresEmploi() {
  titre("💼", "API Offres d'emploi v2 — récupération de TOUTES les offres");

  const token = await getToken("api_offresdemploiv2 o2dsoffre");

  // Critères de recherche (sans `range` : géré par la pagination)
  // ⚠️ `commune` = code INSEE connu du référentiel France Travail.
  //    Lyon = arrondissements 69381..69389 (PAS 69123). Paris = 75101.. etc.
  //    `distance=0` → uniquement la commune demandée (sinon rayon ~10 km + 30%).
  const criteres = {
    motsCles: "développeur",
    commune: "31555", // Toulouse
    distance: "10",
  };

  // 1) Première page : elle nous donne le total
  console.log(`  ${c.dim}⏳ Page initiale pour connaître le total…${c.reset}`);
  const premiere = await fetchPageOffres(token, criteres, 0);
  const total = premiere.total;

  ligne("Total annoncé", total);
  ligne("Reçues page 1", premiere.offres.length);

  // 2) Calcul des pages restantes (l'API plafonne l'index à 3149)
  const PLAFOND_API = 3150;
  const totalAccessible = Math.min(total, PLAFOND_API);
  const debutsRestants: number[] = [];
  for (let debut = TAILLE_PAGE; debut < totalAccessible; debut += TAILLE_PAGE) {
    debutsRestants.push(debut);
  }

  if (total > PLAFOND_API) {
    console.log(
      `  ${c.yellow}⚠️  L'API ne renvoie que les ${PLAFOND_API} premières offres ` +
        `(${total} au total). Affine les critères pour le reste.${c.reset}`,
    );
  }

  // 3) Récupération en batch, concurrence 10, bridée à 10 req/s par le limiteur
  const toutes: Offre[] = [...premiere.offres];
  if (debutsRestants.length > 0) {
    console.log(
      `  ${c.dim}⏳ ${debutsRestants.length} pages restantes ` +
        `(batch, max 10 req/s)…${c.reset}`,
    );
    const debutChrono = Date.now();

    const pages = await mapAvecConcurrence(debutsRestants, 10, async (debut, i) => {
      const page = await fetchPageOffres(token, criteres, debut);
      console.log(
        `     ${c.green}✓${c.reset} page ${i + 2}/${debutsRestants.length + 1} ` +
          `${c.dim}(range ${debut}-${debut + TAILLE_PAGE - 1} → ${page.offres.length} offres)${c.reset}`,
      );
      return page.offres;
    });

    for (const p of pages) toutes.push(...p);
    const secondes = ((Date.now() - debutChrono) / 1000).toFixed(1);
    ligne("Temps pagination", `${secondes}s`);
    ligne("Débit moyen", `${(debutsRestants.length / Number(secondes)).toFixed(1)} req/s`);
  }

  ligne("Offres récupérées", toutes.length);

  // 4) Aperçu des 5 premières
  console.log(`\n  ${c.bold}${c.magenta}Aperçu (5 premières) :${c.reset}`);
  for (const [i, o] of toutes.slice(0, 5).entries()) {
    console.log(
      `\n  ${c.bold}${c.yellow}#${i + 1}${c.reset} ${c.bold}${o.intitule}${c.reset}\n` +
        `     ${c.dim}🏢 Entreprise :${c.reset} ${o.entreprise?.nom ?? "—"}\n` +
        `     ${c.dim}📍 Lieu       :${c.reset} ${o.lieuTravail?.libelle ?? "—"}\n` +
        `     ${c.dim}📄 Contrat    :${c.reset} ${o.typeContratLibelle ?? "—"}\n` +
        `     ${c.dim}🗓️  Créée le   :${c.reset} ${o.dateCreation ?? "—"}`,
    );
  }
}

// ─── 2) API Marché du travail (statistiques offres/demandes) ──────────────────
async function testMarcheTravail() {
  titre("📊", "API Marché du travail — statistiques");

  // ⚠️ DOUBLE scope obligatoire (cf. swagger marchedutravail.json) :
  //    "api_stats-offres-demandes-emploiv1" ET "offresetdemandesemploi".
  //    Sans le second → token valide mais 403 sur la ressource.
  const token = await getToken("api_stats-offres-demandes-emploiv1 offresetdemandesemploi");

  // Statistiques d'offres : informatique (ROME M1805) en Auvergne-Rhône-Alpes (REG 84)
  const url =
    "https://api.francetravail.io/partenaire/stats-offres-demandes-emploi/v1/indicateur/stat-offres";

  // Corps conforme au schéma CritereIndicateurAvecNomenclature
  const body = {
    codeTypeTerritoire: "REG",
    codeTerritoire: "84", // Auvergne-Rhône-Alpes
    codeTypeActivite: "ROME",
    codeActivite: "M1805", // Études et développement informatique
    codeTypePeriode: "TRIMESTRE",
    codeTypeNomenclature: "ORIGINEOFF", // seule nomenclature valide pour stat-offres (OFF_1)
    dernierePeriode: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json", // sinon l'API répond en XML
    },
    body: JSON.stringify(body),
  });

  // Log d'erreur détaillé (status + headers utiles + corps)
  if (!res.ok) {
    const corps = await res.text();
    console.error(`\n  ${c.red}${c.bold}⛔ Réponse ${res.status} ${res.statusText}${c.reset}`);
    ligne("URL", url);
    ligne("Payload envoyé", JSON.stringify(body));
    ligne("WWW-Authenticate", res.headers.get("WWW-Authenticate") ?? "—");
    ligne("Content-Type", res.headers.get("Content-Type") ?? "—");
    ligne("Corps", corps.trim() || "(vide)");
    throw new Error(`Marché du travail KO (${res.status})`);
  }

  type Valeur = {
    libTerritoire?: string;
    libActivite?: string;
    libNomenclature?: string;
    libPeriode?: string;
    valeurPrincipaleNombre?: number;
    valeurSecondairePourcentage?: number;
  };
  const data = (await res.json()) as {
    codeIndicateur?: string;
    libIndicateur?: string;
    listeValeursParPeriode?: Valeur[];
  };

  ligne("Status HTTP", res.status);
  ligne("Indicateur", data.codeIndicateur ?? "—");
  ligne("Libellé", data.libIndicateur?.slice(0, 50) ?? "—");
  ligne("Nb de valeurs", data.listeValeursParPeriode?.length ?? 0);

  console.log(`\n  ${c.bold}${c.magenta}Valeurs par origine d'offre :${c.reset}`);
  for (const v of data.listeValeursParPeriode ?? []) {
    console.log(
      `\n  ${c.bold}${c.yellow}▸ ${v.libNomenclature ?? "?"}${c.reset} ` +
        `${c.dim}(${v.libPeriode})${c.reset}\n` +
        `     ${c.dim}📍 Territoire :${c.reset} ${v.libTerritoire ?? "—"}\n` +
        `     ${c.dim}💼 Activité   :${c.reset} ${v.libActivite ?? "—"}\n` +
        `     ${c.dim}🔢 Nombre     :${c.reset} ${c.green}${v.valeurPrincipaleNombre ?? "—"}${c.reset}\n` +
        `     ${c.dim}📈 %          :${c.reset} ${v.valeurSecondairePourcentage ?? "—"}`,
    );
  }
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────
async function main() {
  console.log(`${c.bold}${c.cyan}🚀 Démo APIs France Travail${c.reset}`);

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
      `\n${c.red}❌ FT_CLIENT_ID / FT_CLIENT_SECRET manquants.${c.reset}\n` +
        `   Ajoute-les dans le fichier .env puis relance ${c.bold}bun index.ts${c.reset}`,
    );
    process.exit(1);
  }

  for (const test of [testOffresEmploi, testMarcheTravail]) {
    try {
      await test();
    } catch (err) {
      console.error(`\n${c.red}❌ ${(err as Error).message}${c.reset}`);
    }
  }

  console.log(`\n${c.bold}${c.green}✅ Terminé.${c.reset}\n`);
}

main();
