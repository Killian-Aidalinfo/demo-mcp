/**
 * Tool MCP autour de La Bonne Boîte v2 : entreprises à fort potentiel d'embauche
 * (candidatures spontanées), qu'elles aient publié une offre ou non.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { localiserCommunes } from "../client/geo";
import {
  dedoublonnerEntreprises,
  rechercherEntreprisesQuiRecrutent,
  resumerEntrepriseLbb,
  type ResumeEntrepriseLbb,
} from "../client/labonneboite";

export function formaterEntreprise(e: ResumeEntrepriseLbb, rang: number): string {
  const details = [
    [e.codePostal, e.ville].filter(Boolean).join(" "),
    e.effectif,
    e.potentielEmbauche !== null ? `potentiel ${e.potentielEmbauche}${e.fortPotentiel ? " (fort)" : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    `${rang}. ${e.entreprise ?? "?"}${e.siret ? ` [SIRET ${e.siret}]` : ""}` +
    (details ? `\n   ${details}` : "") +
    (e.naf ? `\n   ${e.naf}` : "")
  );
}

export function enregistrerToolsEntreprises(server: McpServer): void {
  server.registerTool(
    "entreprises_qui_recrutent",
    {
      description:
        "Entreprises à fort potentiel d'embauche pour un ou plusieurs métiers ROME autour d'une ville " +
        "(La Bonne Boîte, France Travail), y compris SANS offre publiée : la liste à utiliser pour des " +
        "candidatures spontanées, notamment quand aucune offre d'alternance n'est disponible. Triées par " +
        "potentiel d'embauche décroissant. Obtenir les codes ROME avec `identifier_metier` si besoin.",
      inputSchema: {
        ville: z.string().describe("Nom, code postal ou code INSEE (ex. « Nancy », 54000)"),
        romes: z.string().describe("Code(s) ROME séparés par des virgules (ex. M1801,M1830)"),
        rayonKm: z.number().int().min(1).max(199).default(30).describe("Rayon autour de la mairie, en km"),
        naf: z.string().optional().describe("Code(s) NAF séparés par des virgules pour restreindre le secteur (ex. 6202A)"),
        max: z.number().int().min(1).max(100).default(30).describe("Nombre maximum d'entreprises"),
      },
      outputSchema: {
        commune: z.any(),
        total: z.number(),
        entreprises: z.array(z.any()),
      },
    },
    async ({ ville, romes, rayonKm, naf, max }) => {
      const [commune] = await localiserCommunes(ville, 1);
      if (!commune) throw new Error(`Commune introuvable : « ${ville} ».`);
      const decouper = (s?: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const r = await rechercherEntreprisesQuiRecrutent({
        romes: decouper(romes),
        naf: decouper(naf),
        codeInsee: commune.codeInsee,
        distanceKm: rayonKm,
        // Une même entreprise peut ressortir pour chaque code ROME : on demande plus large.
        parPage: Math.min(max * 2, 100),
      });
      const entreprises = dedoublonnerEntreprises(r.entreprises.map(resumerEntrepriseLbb)).slice(0, max);
      const lignes = entreprises.map((e, i) => formaterEntreprise(e, i + 1));
      return {
        content: [
          {
            type: "text",
            text:
              `${r.total} entreprise(s) à potentiel d'embauche à ${rayonKm} km de ${commune.nom} pour ${romes}` +
              (r.total > entreprises.length ? ` (${entreprises.length} premières)` : "") +
              ".\n\n" +
              (lignes.join("\n") || "Aucune entreprise trouvée : élargir le rayon ou les codes ROME.") +
              "\n\nLe potentiel est une estimation statistique de France Travail, pas une offre : vérifier le " +
              "site de l'entreprise avant de candidater.",
          },
        ],
        structuredContent: { commune, total: r.total, entreprises },
      };
    },
  );
}
