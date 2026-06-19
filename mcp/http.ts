/**
 * Transport HTTP (Streamable HTTP) du serveur MCP France Travail.
 *
 * Complément au transport stdio (cf. index.ts) : permet d'exposer le serveur
 * derrière une URL HTTP, par ex. en conteneur (Docker / Coolify).
 *
 * Mode « stateless » : chaque requête POST crée un serveur + transport éphémères
 * (pas de session persistante côté serveur). C'est le mode le plus simple à
 * mettre derrière un reverse-proxy et suffisant pour un serveur « tools only ».
 *
 * Endpoints :
 *   POST <MCP_PATH>   → messages JSON-RPC (réponse JSON directe)
 *   GET  /health      → health-check (pour Coolify / load-balancer)
 *
 * Variables d'environnement :
 *   PORT        port d'écoute (défaut 3000)
 *   MCP_PATH    chemin de l'endpoint MCP (défaut /mcp)
 *   FT_CLIENT_ID / FT_CLIENT_SECRET  identifiants API France Travail
 *
 * Nécessite le runtime Bun (utilise `Bun.serve`).
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { creerServeur } from "./index";

export function demarrerServeurHttp() {
  const port = Number(process.env.PORT ?? 3000);
  const mcpPath = process.env.MCP_PATH ?? "/mcp";

  if (!process.env.FT_CLIENT_ID || !process.env.FT_CLIENT_SECRET) {
    console.error(
      "⚠️  FT_CLIENT_ID / FT_CLIENT_SECRET absents de l'environnement — les appels API échoueront.",
    );
  }

  const serveur = Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);

      // Health-check
      if (req.method === "GET" && url.pathname === "/health") {
        return Response.json({ status: "ok", transport: "http" });
      }

      // Endpoint MCP (stateless)
      if (url.pathname === mcpPath) {
        const server = creerServeur();
        const transport = new WebStandardStreamableHTTPServerTransport({
          // stateless : pas d'identifiant de session
          sessionIdGenerator: undefined,
          // réponse JSON directe (pas de flux SSE)
          enableJsonResponse: true,
        });
        try {
          await server.connect(transport);
          return await transport.handleRequest(req);
        } finally {
          // Le corps de réponse est déjà matérialisé (enableJsonResponse),
          // on peut libérer serveur + transport éphémères.
          await transport.close().catch(() => {});
          await server.close().catch(() => {});
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.error(
    `Serveur MCP France Travail démarré (HTTP) sur http://${serveur.hostname}:${serveur.port}${mcpPath}`,
  );
  return serveur;
}
