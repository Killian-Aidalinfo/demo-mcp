/**
 * Serveur MCP France Travail.
 *
 * Expose les APIs France Travail (Offres d'emploi v2 & Marché du travail) sous
 * forme de tools MCP, plus des tools « assistants » (référentiels, codes INSEE,
 * territoires) pour aider un modèle à construire des requêtes valides.
 *
 * Lancement :
 *   - stdio (défaut, pour npx / install npm) : `bun mcp/index.ts`
 *   - HTTP (pour Docker / Coolify)           : `MCP_TRANSPORT=http bun mcp/index.ts`
 *                                              ou `bun mcp/index.ts --http`
 * Pré-requis : FT_CLIENT_ID / FT_CLIENT_SECRET dans .env (cf. README).
 *
 * ⚠️ stdio : stdout est réservé au JSON-RPC. Tous les logs vont sur stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { enregistrerTousLesTools } from "./tools";

export function creerServeur(): McpServer {
  const server = new McpServer({
    name: "france-travail",
    version: "1.0.0",
  });
  enregistrerTousLesTools(server);
  return server;
}

/** Vrai si le transport HTTP est demandé (env `MCP_TRANSPORT=http` ou flag `--http`). */
function transportHttpDemande(): boolean {
  return (
    process.env.MCP_TRANSPORT?.toLowerCase() === "http" ||
    process.argv.includes("--http")
  );
}

async function main() {
  // Transport HTTP : délégué à http.ts (nécessite Bun). Import dynamique pour
  // que le build npm (stdio, target node) n'embarque pas le code Bun.serve.
  if (transportHttpDemande()) {
    const { demarrerServeurHttp } = await import("./http");
    demarrerServeurHttp();
    return;
  }

  if (!process.env.FT_CLIENT_ID || !process.env.FT_CLIENT_SECRET) {
    console.error(
      "⚠️  FT_CLIENT_ID / FT_CLIENT_SECRET absents de l'environnement — les appels API échoueront.",
    );
  }
  const server = creerServeur();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Serveur MCP France Travail démarré (stdio).");
}

/**
 * Vrai si ce module est le point d'entrée exécuté.
 * Bun expose `import.meta.main` ; Node ne l'a qu'à partir de la v24, on retombe
 * donc sur une comparaison entre l'URL du module et le script lancé (process.argv[1]).
 */
function estPointEntree(): boolean {
  const meta = import.meta as ImportMeta & { main?: boolean };
  if (typeof meta.main === "boolean") return meta.main;
  const argv1 = process.argv[1];
  return argv1 ? import.meta.url === pathToFileURL(argv1).href : false;
}

if (estPointEntree()) {
  main().catch((error) => {
    console.error("Erreur fatale dans main():", error);
    process.exit(1);
  });
}
