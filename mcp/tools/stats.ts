/**
 * Tools MCP autour de l'API Marché du travail (statistiques par territoire).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  INDICATEURS,
  statistiquesMarche,
  detailsIndicateurs,
  salairesMetier,
  TYPES_SALAIRE,
  type Indicateur,
} from "../client/stats";

function euros(montant: number | null): string {
  return montant === null ? "—" : `${montant.toLocaleString("fr-FR")} €`;
}

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

  server.registerTool(
    "salaires_metier",
    {
      description:
        "Salaires mensuels des salariés en poste pour un métier ROME sur un territoire (API Marché du travail, " +
        "indicateur SAL_3) : moins de 35 ans, 35 ans et plus, tous âges. Un code ROME couvre une ou plusieurs " +
        "familles professionnelles (FAP), d'où plusieurs lignes. Donne un ordre de grandeur, pas une grille : " +
        "la rémunération d'un apprenti suit le barème légal (pourcentage du SMIC selon l'âge et l'année).",
      inputSchema: {
        codeRome: z.string().describe("Code ROME, ex. M1801"),
        codeTypeTerritoire: z.enum(["NAT", "REG", "DEP"]).default("DEP").describe("NAT, REG ou DEP"),
        codeTerritoire: z.string().default("54").describe("Code du territoire (ex. 54 Meurthe-et-Moselle, 44 Grand Est, FR pour NAT)"),
      },
      outputSchema: {
        libIndicateur: z.string().nullable(),
        salaires: z.array(z.any()),
      },
    },
    async ({ codeRome, codeTypeTerritoire, codeTerritoire }) => {
      const r = await salairesMetier(codeRome, codeTypeTerritoire, codeTerritoire);
      const lignes = r.salaires.map(
        (s) =>
          `▸ ${s.libelle ?? s.codeFap ?? "?"} (${s.codeFap ?? "?"}, ${s.periode ?? "?"}) — ` +
          `${TYPES_SALAIRE.SAL1} : ${euros(s.moins35ans)} · ${TYPES_SALAIRE.SAL2} : ${euros(s.plus35ans)} · ` +
          `${TYPES_SALAIRE.SAL3} : ${euros(s.tousAges)}`,
      );
      return {
        content: [
          {
            type: "text",
            text:
              `Salaires mensuels en poste — ${codeRome} — ${codeTypeTerritoire} ${codeTerritoire}\n\n` +
              (lignes.join("\n") || "Aucune donnée pour ce métier sur ce territoire : essayer REG ou NAT."),
          },
        ],
        structuredContent: { libIndicateur: r.libIndicateur, salaires: r.salaires },
      };
    },
  );
}
