/**
 * Tool MCP de recherche d'alternances multi-sources (France Travail + La bonne alternance).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { rechercherAlternances, type OffreUnifiee } from "../client/recherche-alternances";

function formaterOffreUnifiee(o: OffreUnifiee, rang: number): string {
  const details = [o.lieu, o.contrat, o.niveau, o.datePublication?.slice(0, 10)].filter(Boolean).join(" · ");
  return (
    `${rang}. ${o.intitule ?? "—"} — ${o.entreprise ?? "?"} [${o.source}` +
    `${o.id && o.outilDetail ? ` · ${o.outilDetail}("${o.id}")` : ""}]` +
    (details ? `\n   ${details}` : "") +
    (o.url ? `\n   ${o.url}` : "")
  );
}

export function enregistrerToolsRecherche(server: McpServer): void {
  server.registerTool(
    "rechercher_alternances",
    {
      description:
        "POINT D'ENTRÉE RECOMMANDÉ pour trouver des offres d'ALTERNANCE (apprentissage / " +
        "professionnalisation) autour d'une ville. Localise la ville, interroge EN PARALLÈLE France " +
        "Travail et La bonne alternance, fusionne et dédoublonne, plus récentes d'abord. Si une source est " +
        "indisponible, l'autre répond quand même (voir `avertissements`). Codes ROME utiles en informatique " +
        "infra : M1801 (administration de systèmes d'information), M1810 (production et exploitation de SI), " +
        "I1401 (maintenance informatique). Pour le détail d'une offre, appelle le tool indiqué entre crochets.",
      inputSchema: {
        ville: z.string().describe("Nom, code postal ou code INSEE (ex. « Nancy », 54000)"),
        rayonKm: z.number().int().min(0).max(200).default(30).describe("Rayon de recherche en km"),
        romes: z.string().optional().describe("Code(s) ROME séparés par des virgules (ex. M1801,M1810)"),
        motsCles: z.string().optional().describe("Mots-clés (appliqués à France Travail uniquement)"),
        niveauDiplome: z
          .enum(["3", "4", "5", "6", "7"])
          .optional()
          .describe(
            "Niveau de diplôme visé (La bonne alternance uniquement) : 3 CAP, 4 Bac, 5 Bac+2, " +
              "6 Bac+3/licence, 7 Bac+5. Les offres sans niveau précisé sont aussi renvoyées.",
          ),
        publieeDepuis: z.number().int().optional().describe("Offres publiées depuis N jours (France Travail uniquement : 1, 3, 7, 14, 31)"),
        maxParSource: z.number().int().min(1).max(500).default(100).describe("Nombre max d'offres récupérées par source"),
        inclureRecruteurs: z
          .boolean()
          .default(false)
          .describe(
            "Ajouter les entreprises susceptibles de recruter sans offre publiée (candidature spontanée) : " +
              "La Bonne Boîte (si `romes` est renseigné) + recruteurs de La bonne alternance",
          ),
      },
      outputSchema: {
        commune: z.any(),
        offres: z.array(z.any()),
        parSource: z.object({ franceTravail: z.number().nullable(), laBonneAlternance: z.number().nullable() }),
        doublonsRetires: z.number(),
        recruteurs: z.array(z.any()),
        avertissements: z.array(z.string()),
      },
    },
    async (criteres) => {
      const r = await rechercherAlternances(criteres);
      const sources = [
        `France Travail : ${r.parSource.franceTravail ?? "indisponible"}`,
        `La bonne alternance : ${r.parSource.laBonneAlternance ?? "indisponible"}`,
      ].join(", ");
      const lignes = r.offres.slice(0, 40).map((o, i) => formaterOffreUnifiee(o, i + 1));
      const recruteurs = r.recruteurs
        .slice(0, 20)
        .map(
          (e) =>
            `- ${e.entreprise ?? "?"} — ${e.adresse ?? "?"} [${e.source}` +
            `${e.potentielEmbauche !== null ? ` · potentiel ${e.potentielEmbauche}` : ""}]` +
            `${e.siret ? ` · SIRET ${e.siret}` : ""}${e.url ? ` · ${e.url}` : ""}`,
        );
      const texte = [
        `${r.offres.length} offre(s) d'alternance à ${criteres.rayonKm} km de ${r.commune.nom} ` +
          `(${sources} ; ${r.doublonsRetires} doublon(s) retiré(s))` +
          (r.offres.length > 40 ? ". 40 premières affichées, toutes dans structuredContent." : "."),
        ...(r.avertissements.length ? ["", "⚠️ " + r.avertissements.join("\n⚠️ ")] : []),
        "",
        ...lignes,
        ...(recruteurs.length ? ["", `Entreprises susceptibles de recruter (${r.recruteurs.length}) :`, ...recruteurs] : []),
      ].join("\n");
      return {
        content: [{ type: "text", text: texte }],
        structuredContent: r,
      };
    },
  );
}
