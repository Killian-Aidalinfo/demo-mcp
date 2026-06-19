/**
 * Tools MCP autour de l'API Offres d'emploi v2.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { rechercherOffres, consulterOffre } from "../client/offres";

export function enregistrerToolsOffres(server: McpServer): void {
  server.registerTool(
    "rechercher_offres",
    {
      description:
        "Recherche des offres d'emploi France Travail selon des critères (mots-clés, " +
        "localisation par code INSEE, métier ROME, type de contrat…). Pour la localisation, " +
        "utilise d'abord `chercher_code_insee` pour obtenir un code de commune/département/région valide. " +
        "Pagination automatique jusqu'à `maxResultats` (plafond API ~3150).",
      inputSchema: {
        motsCles: z.string().optional().describe("Mots-clés (intitulé, compétences)"),
        commune: z.string().optional().describe("Code INSEE de commune (ex. 31555 Toulouse). Lyon global 69123 est refusé → arrondissements 69381..69389"),
        departement: z.string().optional().describe("Code département (ex. 69)"),
        region: z.string().optional().describe("Code région INSEE (ex. 84)"),
        codeROME: z.string().optional().describe("Code métier ROME (ex. M1805)"),
        typeContrat: z.string().optional().describe("Type de contrat (CDI, CDD, MIS…)"),
        distance: z.number().int().min(0).optional().describe("Rayon en km autour de la commune (0 = commune seule)"),
        publieeDepuis: z.number().int().optional().describe("Offres publiées depuis N jours (1, 3, 7, 14, 31)"),
        tempsPlein: z.boolean().optional().describe("Filtrer temps plein/partiel"),
        maxResultats: z.number().int().min(1).max(3150).default(50).describe("Nombre max d'offres à récupérer"),
      },
      outputSchema: {
        total: z.number().describe("Total d'offres disponibles côté API"),
        recuperees: z.number(),
        offres: z.array(z.any()),
      },
    },
    async ({ maxResultats, ...criteres }) => {
      const resultat = await rechercherOffres(criteres, maxResultats);
      const apercu = resultat.offres
        .slice(0, 10)
        .map(
          (o, i) =>
            `${i + 1}. ${o.intitule ?? "—"} — ${o.entreprise?.nom ?? "?"} ` +
            `(${o.lieuTravail?.libelle ?? "?"}, ${o.typeContratLibelle ?? o.typeContrat ?? "?"})`,
        )
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text:
              `${resultat.recuperees} offre(s) récupérée(s) sur ${resultat.total} disponible(s).\n\n${apercu}`,
          },
        ],
        structuredContent: resultat,
      };
    },
  );

  server.registerTool(
    "consulter_offre",
    {
      description:
        "Consulte le détail complet d'une offre d'emploi par son identifiant " +
        "(description, lieu, entreprise, contrat, salaire, compétences…).",
      inputSchema: {
        id: z.string().describe("Identifiant de l'offre"),
      },
      outputSchema: {
        trouvee: z.boolean(),
        offre: z.any().optional(),
      },
    },
    async ({ id }) => {
      const offre = await consulterOffre(id);
      if (!offre) {
        return {
          content: [{ type: "text", text: `Aucune offre trouvée pour l'identifiant ${id}.` }],
          structuredContent: { trouvee: false },
        };
      }
      return {
        content: [
          {
            type: "text",
            text:
              `${offre.intitule ?? "—"}\n` +
              `Entreprise : ${offre.entreprise?.nom ?? "—"}\n` +
              `Lieu : ${offre.lieuTravail?.libelle ?? "—"}\n` +
              `Contrat : ${offre.typeContratLibelle ?? offre.typeContrat ?? "—"}\n` +
              `Salaire : ${offre.salaire?.libelle ?? "—"}\n\n` +
              `${(offre.description ?? "").slice(0, 800)}`,
          },
        ],
        structuredContent: { trouvee: true, offre },
      };
    },
  );
}
