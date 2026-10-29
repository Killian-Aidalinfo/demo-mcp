/**
 * Tools MCP autour de l'API Offres d'emploi v2.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  rechercherOffres,
  rechercherOffresEnAlternance,
  consulterOffre,
  resumerOffre,
  urlOffre,
  type OffreResumee,
} from "../client/offres";

/** Ligne compacte d'une offre résumée (texte renvoyé au modèle). */
export function formaterOffre(o: OffreResumee, rang: number): string {
  const contrat = [o.contrat, o.natureContrat].filter(Boolean).join(" · ") || "?";
  return (
    `${rang}. [${o.id ?? "?"}] ${o.intitule ?? "—"} — ${o.entreprise ?? "?"} ` +
    `(${o.lieu ?? "?"}, ${contrat}${o.datePublication ? `, publiée le ${o.datePublication.slice(0, 10)}` : ""})` +
    (o.url ? `\n   ${o.url}` : "")
  );
}

export function enregistrerToolsOffres(server: McpServer): void {
  server.registerTool(
    "rechercher_offres",
    {
      description:
        "Recherche des offres d'emploi France Travail selon des critères (mots-clés, " +
        "localisation par code INSEE, métier ROME, type ou nature de contrat, niveau de formation…). " +
        "Pour la localisation, utilise d'abord `localiser_commune` ou `chercher_code_insee` pour obtenir un code " +
        "de commune/département/région valide. `alternance: true` limite aux contrats d'apprentissage et de " +
        "professionnalisation. Pagination automatique jusqu'à `maxResultats` (plafond API ~3150).",
      inputSchema: {
        motsCles: z.string().optional().describe("Mots-clés (intitulé, compétences), séparés par des virgules"),
        commune: z.string().optional().describe("Code INSEE de commune (ex. 54395 Nancy). Lyon global 69123 est refusé → arrondissements 69381..69389"),
        distance: z.number().int().min(0).optional().describe("Rayon en km autour de la commune (0 = commune seule ; défaut API 10)"),
        departement: z.string().optional().describe("Code(s) département, séparés par des virgules (ex. 54 ou 54,57)"),
        inclureLimitrophes: z.boolean().optional().describe("Avec `departement` : inclure les départements limitrophes"),
        region: z.string().optional().describe("Code région INSEE (ex. 44 Grand Est)"),
        codeROME: z.string().optional().describe("Code(s) métier ROME, séparés par des virgules (ex. M1801,M1810)"),
        appellation: z.string().optional().describe("Code d'appellation ROME (référentiel `appellations`)"),
        alternance: z.boolean().optional().describe("true = uniquement l'alternance (apprentissage E2 + professionnalisation FS). Ignore `natureContrat`."),
        natureContrat: z.string().optional().describe("Code de nature de contrat (E2 apprentissage, FS professionnalisation… ; référentiel `naturesContrats`)"),
        typeContrat: z.string().optional().describe("Type(s) de contrat, séparés par des virgules (CDI, CDD, MIS…)"),
        niveauFormation: z.string().optional().describe("Code de niveau de formation (référentiel `niveauxFormations`)"),
        experience: z.enum(["0", "1", "2", "3"]).optional().describe("Expérience : 0 non précisée, 1 moins d'un an, 2 de 1 à 3 ans, 3 plus de 3 ans"),
        qualification: z.enum(["0", "9"]).optional().describe("0 = non cadre, 9 = cadre"),
        publieeDepuis: z.number().int().optional().describe("Offres publiées depuis N jours (1, 3, 7, 14, 31)"),
        tempsPlein: z.boolean().optional().describe("Filtrer temps plein/partiel"),
        sort: z.number().int().min(0).max(2).optional().describe("Tri : 0 pertinence, 1 date de création, 2 distance"),
        maxResultats: z.number().int().min(1).max(3150).default(50).describe("Nombre max d'offres à récupérer"),
        details: z.boolean().default(false).describe("true = renvoyer les offres brutes complètes dans structuredContent (volumineux)"),
      },
      outputSchema: {
        total: z.number().describe("Total d'offres disponibles côté API"),
        recuperees: z.number(),
        offres: z.array(z.any()),
      },
    },
    async ({ maxResultats, details, alternance, natureContrat, ...criteres }) => {
      const resultat = alternance
        ? await rechercherOffresEnAlternance(criteres, maxResultats)
        : await rechercherOffres({ ...criteres, natureContrat }, maxResultats);
      const resumes = resultat.offres.map(resumerOffre);
      const apercu = resumes.slice(0, 30).map((o, i) => formaterOffre(o, i + 1)).join("\n");
      return {
        content: [
          {
            type: "text",
            text:
              `${resultat.recuperees} offre(s) récupérée(s) sur ${resultat.total} disponible(s)` +
              (resumes.length > 30 ? ` (30 premières affichées, toutes dans structuredContent)` : "") +
              `. L'identifiant entre crochets [ID] est utilisable avec \`consulter_offre\`.\n\n${apercu}`,
          },
        ],
        structuredContent: {
          total: resultat.total,
          recuperees: resultat.recuperees,
          offres: details ? resultat.offres : resumes,
        },
      };
    },
  );

  server.registerTool(
    "consulter_offre",
    {
      description:
        "Consulte le détail complet d'une offre d'emploi France Travail par son identifiant " +
        "(description, lieu, entreprise, contrat, salaire, compétences, formation, expérience…).",
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
          content: [{ type: "text", text: `Aucune offre trouvée pour l'identifiant ${id} (expirée ou retirée).` }],
          structuredContent: { trouvee: false },
        };
      }
      const r = resumerOffre(offre);
      return {
        content: [
          {
            type: "text",
            text:
              `${r.intitule ?? "—"} [${r.id ?? id}]\n` +
              `Entreprise : ${r.entreprise ?? "—"}\n` +
              `Lieu : ${r.lieu ?? "—"}\n` +
              `Contrat : ${[r.contrat, r.natureContrat].filter(Boolean).join(" · ") || "—"}` +
              `${r.alternance ? " (alternance)" : ""}\n` +
              `Formation : ${r.formation ?? "—"}\n` +
              `Expérience : ${r.experience ?? "—"}\n` +
              `Salaire : ${r.salaire ?? "—"}\n` +
              `Publiée le : ${r.datePublication?.slice(0, 10) ?? "—"}\n` +
              `Lien : ${urlOffre(offre) ?? "—"}\n\n` +
              `${(offre.description ?? "").slice(0, 2000)}`,
          },
        ],
        structuredContent: { trouvee: true, offre },
      };
    },
  );
}
