/**
 * Tools MCP autour de l'API Marché du travail (statistiques par territoire).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  INDICATEURS,
  statistiquesMarche,
  detailsIndicateurs,
  type Indicateur,
} from "../client/stats";

export function enregistrerToolsStats(server: McpServer): void {
  server.registerTool(
    "statistiques_marche",
    {
      description:
        "Statistiques agrégées du marché du travail par territoire (région/département/national) : " +
        "volumes d'offres, demandeurs, embauches, tension… Pour le codeTerritoire, utilise " +
        "`lister_territoires_stats`. Chaque indicateur impose des nomenclatures précises : en cas de " +
        "doute appelle `decouvrir_indicateurs`. Ex. stat-offres → codeTypeNomenclature=ORIGINEOFF.",
      inputSchema: {
        indicateur: z
          .enum(Object.keys(INDICATEURS) as [Indicateur, ...Indicateur[]])
          .describe(
            "Indicateur : " +
              Object.entries(INDICATEURS)
                .map(([k, v]) => `${k} (${v})`)
                .join(", "),
          ),
        codeTypeTerritoire: z.string().default("REG").describe("NAT, REG, DEP, BASSIN…"),
        codeTerritoire: z.string().describe("Code du territoire (ex. 84 = Auvergne-Rhône-Alpes)"),
        codeTypeActivite: z.string().optional().describe("Ex. ROME"),
        codeActivite: z.string().optional().describe("Ex. M1805"),
        codeTypePeriode: z.string().optional().describe("TRIMESTRE, ANNEE…"),
        codeTypeNomenclature: z.string().optional().describe("Ex. ORIGINEOFF pour stat-offres"),
        dernierePeriode: z.boolean().default(true).describe("Renvoyer la dernière période disponible"),
      },
      outputSchema: {
        codeIndicateur: z.string().optional(),
        libIndicateur: z.string().optional(),
        valeurs: z.array(z.any()),
      },
    },
    async ({ indicateur, ...critere }) => {
      const data = await statistiquesMarche(indicateur, critere);
      const valeurs = data.listeValeursParPeriode ?? [];
      const apercu = valeurs
        .map(
          (v) =>
            `▸ ${v.libNomenclature ?? "?"} (${v.libPeriode ?? "?"}) — ` +
            `${v.libTerritoire ?? "?"} : ${v.valeurPrincipaleNombre ?? "—"}` +
            (v.valeurSecondairePourcentage != null ? ` (${v.valeurSecondairePourcentage}%)` : ""),
        )
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${data.libIndicateur ?? indicateur} — ${valeurs.length} valeur(s)\n\n${apercu}`,
          },
        ],
        structuredContent: {
          codeIndicateur: data.codeIndicateur,
          libIndicateur: data.libIndicateur,
          valeurs,
        },
      };
    },
  );

  server.registerTool(
    "decouvrir_indicateurs",
    {
      description:
        "Liste les combinaisons valides (indicateur × activité × nomenclature × période) de l'API " +
        "Marché du travail. À utiliser pour savoir quels codeTypeNomenclature / codeTypeActivite " +
        "passer à `statistiques_marche` sans déclencher d'erreur.",
      inputSchema: {},
    },
    async () => {
      const data = await detailsIndicateurs();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2).slice(0, 4000) }],
      };
    },
  );
}
