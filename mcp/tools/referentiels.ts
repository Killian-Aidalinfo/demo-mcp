/**
 * Tools MCP « assistants » : aident l'IA à construire ses requêtes en lui donnant
 * accès aux référentiels (codes INSEE, ROME, territoires…).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  REFERENTIELS_OFFRES,
  type ReferentielOffres,
  getReferentiel,
  chercherDansReferentiel,
} from "../client/offres";
import { listerTerritoires } from "../client/stats";
import { localiserCommunes } from "../client/geo";

export function enregistrerToolsReferentiels(server: McpServer): void {
  server.registerTool(
    "localiser_commune",
    {
      description:
        "Localise une commune française à partir de son nom, code postal ou code INSEE (API publique " +
        "geo.api.gouv.fr, sans clé). Renvoie en un appel le code INSEE (pour `rechercher_offres`, param " +
        "`commune`), le département et les coordonnées GPS (pour `rechercher_offres_alternance`, params " +
        "`latitude`/`longitude`). À utiliser en premier pour toute recherche autour d'une ville.",
      inputSchema: {
        recherche: z.string().describe("Nom (ex. « Nancy »), code postal (54000) ou code INSEE (54395)"),
        limite: z.number().int().min(1).max(20).default(5),
      },
      outputSchema: {
        communes: z.array(z.any()),
      },
    },
    async ({ recherche, limite }) => {
      const communes = await localiserCommunes(recherche, limite);
      const texte = communes.length
        ? communes
            .map(
              (c) =>
                `${c.nom} (${c.departement}) — INSEE ${c.codeInsee}, CP ${c.codesPostaux.join("/") || "?"}, ` +
                `lat ${c.latitude ?? "?"}, lon ${c.longitude ?? "?"}` +
                (c.population ? `, ${c.population} hab.` : ""),
            )
            .join("\n")
        : `Aucune commune trouvée pour « ${recherche} ».`;
      return {
        content: [{ type: "text", text: texte }],
        structuredContent: { communes },
      };
    },
  );

  server.registerTool(
    "chercher_code_insee",
    {
      description:
        "Trouve un code (INSEE pour les communes, code département/région, code ROME…) à partir d'un " +
        "nom. INDISPENSABLE avant `rechercher_offres` ou `statistiques_marche` : ex. « Lyon » → codes " +
        "INSEE des arrondissements, « informatique » → codes ROME. Cherche dans le référentiel indiqué.",
      inputSchema: {
        referentiel: z
          .enum(REFERENTIELS_OFFRES as unknown as [string, ...string[]])
          .default("communes")
          .describe(
            "Référentiel à interroger : communes (codes INSEE), departements, regions, metiers, " +
              "appellations (ROME), typesContrats, naturesContrats, secteursActivites, nafs…",
          ),
        recherche: z.string().describe("Texte recherché (nom de ville, métier, etc.)"),
        limite: z.number().int().min(1).max(100).default(20),
      },
      outputSchema: {
        resultats: z.array(z.object({ code: z.string(), libelle: z.string() }).passthrough()),
      },
    },
    async ({ referentiel, recherche, limite }) => {
      const resultats = await chercherDansReferentiel(
        referentiel as ReferentielOffres,
        recherche,
        limite,
      );
      const texte = resultats.length
        ? resultats.map((r) => `${r.code} — ${r.libelle}`).join("\n")
        : `Aucun résultat pour « ${recherche} » dans le référentiel ${referentiel}.`;
      return {
        content: [{ type: "text", text: texte }],
        structuredContent: { resultats },
      };
    },
  );

  server.registerTool(
    "lister_referentiel",
    {
      description:
        "Récupère un référentiel complet de l'API Offres d'emploi (ex. `typesContrats`, `regions`, " +
        "`naturesContrats`). Pour `communes` (très volumineux : tous les codes INSEE), préfère " +
        "`chercher_code_insee`. Renvoie au plus `limite` entrées.",
      inputSchema: {
        referentiel: z
          .enum(REFERENTIELS_OFFRES as unknown as [string, ...string[]])
          .describe("Nom du référentiel"),
        limite: z.number().int().min(1).max(2000).default(200),
      },
      outputSchema: {
        nombreTotal: z.number(),
        entrees: z.array(z.any()),
      },
    },
    async ({ referentiel, limite }) => {
      const toutes = await getReferentiel(referentiel as ReferentielOffres);
      const entrees = toutes.slice(0, limite);
      return {
        content: [
          {
            type: "text",
            text:
              `${toutes.length} entrée(s) dans ${referentiel} (affichage des ${entrees.length} premières) :\n\n` +
              entrees.map((e) => `${e.code} — ${e.libelle}`).join("\n"),
          },
        ],
        structuredContent: { nombreTotal: toutes.length, entrees },
      };
    },
  );

  server.registerTool(
    "lister_territoires_stats",
    {
      description:
        "Liste les territoires (avec leurs codes) acceptés par l'API Marché du travail pour un type " +
        "donné : REG (régions), DEP (départements), BASSIN… À utiliser pour remplir `codeTerritoire` " +
        "de `statistiques_marche`.",
      inputSchema: {
        codeTypeTerritoire: z.string().default("REG").describe("NAT, REG, DEP, BASSIN…"),
      },
      outputSchema: {
        territoires: z.array(z.any()),
      },
    },
    async ({ codeTypeTerritoire }) => {
      const territoires = await listerTerritoires(codeTypeTerritoire);
      return {
        content: [
          {
            type: "text",
            text:
              `${territoires.length} territoire(s) de type ${codeTypeTerritoire} :\n\n` +
              territoires.map((t) => `${t.code} — ${t.libelle}`).join("\n"),
          },
        ],
        structuredContent: { territoires },
      };
    },
  );
}
