/**
 * Enregistrement de tous les tools du serveur MCP France Travail.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enregistrerToolsOffres } from "./offres";
import { enregistrerToolsStats } from "./stats";
import { enregistrerToolsReferentiels } from "./referentiels";
import { enregistrerToolsAlternance } from "./alternance";
import { enregistrerToolsRecherche } from "./recherche";

export function enregistrerTousLesTools(server: McpServer): void {
  enregistrerToolsOffres(server);
  enregistrerToolsStats(server);
  enregistrerToolsReferentiels(server);
  enregistrerToolsAlternance(server);
  enregistrerToolsRecherche(server);
}
