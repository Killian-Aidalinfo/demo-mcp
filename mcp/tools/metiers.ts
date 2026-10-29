/**
 * Tools MCP autour des métiers et compétences : ROMEO v2 (rapprochement IA d'un texte
 * libre avec le ROME) et ROME 4.0 (Métiers, Fiches métiers, Compétences).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { predireMetiers, predireCompetences } from "../client/romeo";
import {
  rechercherMetiers,
  rechercherAppellations,
  lireMetier,
  lireFicheMetier,
  lireCompetence,
  resumerFicheMetier,
} from "../client/rome";

function pourcentage(score: number): string {
  return `${Math.round(score * 100)} %`;
}

function liste(titre: string, elements: string[], max = 12): string[] {
  if (elements.length === 0) return [];
  const extra = elements.length > max ? ` (+${elements.length - max})` : "";
  return [`${titre} : ${elements.slice(0, max).join(" ; ")}${extra}`];
}

export function enregistrerToolsMetiers(server: McpServer): void {
  server.registerTool(
    "identifier_metier",
    {
      description:
        "Trouve le(s) code(s) ROME correspondant à un intitulé libre (« admin sys et réseau », « technicien " +
        "support N2 »…) grâce à l'IA ROMEO de France Travail, avec un score de confiance. À utiliser AVANT une " +
        "recherche d'offres ou d'entreprises pour ne pas deviner les codes ROME. `type: competence` rapproche " +
        "plutôt une compétence libre (« configurer un pare-feu ») du référentiel de compétences ROME.",
      inputSchema: {
        intitule: z.string().min(2).describe("Intitulé de poste ou compétence en texte libre"),
        contexte: z.string().optional().describe("Contexte qui aide l'IA (secteur, type de contrat…), ex. « alternance informatique »"),
        type: z.enum(["metier", "competence"]).default("metier"),
        nbResultats: z.number().int().min(1).max(25).default(5),
      },
      outputSchema: { resultats: z.array(z.any()) },
    },
    async ({ intitule, contexte, type, nbResultats }) => {
      if (type === "competence") {
        const resultats = await predireCompetences(intitule, contexte, nbResultats);
        const lignes = resultats.map(
          (c, i) =>
            `${i + 1}. ${c.libelleCompetence} [${c.codeCompetence}${c.typeCompetence ? ` · ${c.typeCompetence}` : ""}] — ${pourcentage(c.scorePrediction)}`,
        );
        return {
          content: [{ type: "text", text: `Compétences ROME proches de « ${intitule} » :\n${lignes.join("\n") || "aucune"}` }],
          structuredContent: { resultats },
        };
      }
      const resultats = await predireMetiers(intitule, contexte, nbResultats);
      const lignes = resultats.map(
        (m, i) =>
          `${i + 1}. ${m.codeRome} ${m.libelleRome} — appellation « ${m.libelleAppellation} » ` +
          `[${m.codeAppellation}] — ${pourcentage(m.scorePrediction)}`,
      );
      return {
        content: [
          {
            type: "text",
            text:
              `Métiers ROME proches de « ${intitule} » :\n${lignes.join("\n") || "aucun"}\n\n` +
              "Le code ROME (lettre + 4 chiffres) s'utilise dans `rechercher_alternances`, `rechercher_offres` " +
              "(codeROME) et `entreprises_qui_recrutent`.",
          },
        ],
        structuredContent: { resultats },
      };
    },
  );

  server.registerTool(
    "rechercher_metier",
    {
      description:
        "Recherche plein texte dans le référentiel ROME 4.0 : métiers (fiches ROME) ou appellations " +
        "(intitulés de poste rattachés à un métier). Plus déterministe que `identifier_metier`, utile pour " +
        "lister les variantes d'un métier.",
      inputSchema: {
        q: z.string().min(2).describe("Mot(s) ou début de mot(s), ex. « administrateur reseau »"),
        cible: z.enum(["metiers", "appellations"]).default("metiers"),
        max: z.number().int().min(1).max(100).default(20),
      },
      outputSchema: { total: z.number(), resultats: z.array(z.any()) },
    },
    async ({ q, cible, max }) => {
      if (cible === "appellations") {
        const r = await rechercherAppellations(q);
        const resultats = r.resultats.slice(0, max);
        const lignes = resultats.map(
          (a) => `- ${a.libelle} [${a.code}]${a.metier ? ` → ${a.metier.code} ${a.metier.libelle}` : ""}`,
        );
        return {
          content: [{ type: "text", text: `${r.total} appellation(s) pour « ${q} »${r.total > max ? ` (${max} premières)` : ""} :\n${lignes.join("\n")}` }],
          structuredContent: { total: r.total, resultats },
        };
      }
      const r = await rechercherMetiers(q);
      const resultats = r.resultats.slice(0, max);
      const lignes = resultats.map((m) => `- ${m.code} ${m.libelle}`);
      return {
        content: [{ type: "text", text: `${r.total} métier(s) pour « ${q} »${r.total > max ? ` (${max} premiers)` : ""} :\n${lignes.join("\n")}` }],
        structuredContent: { total: r.total, resultats },
      };
    },
  );

  server.registerTool(
    "fiche_metier",
    {
      description:
        "Fiche d'un métier ROME 4.0 : définition, accès à l'emploi (diplômes), intitulés de poste, compétences " +
        "attendues regroupées par enjeu, savoirs (outils, normes, certifications) et contextes de travail. Idéal " +
        "pour préparer un CV, une lettre de motivation ou un entretien.",
      inputSchema: {
        code: z.string().describe("Code ROME, ex. M1801"),
      },
      outputSchema: { trouve: z.boolean(), fiche: z.any().optional() },
    },
    async ({ code }) => {
      const [metier, fiche] = await Promise.all([lireMetier(code), lireFicheMetier(code)]);
      if (!metier && !fiche) {
        return {
          content: [{ type: "text", text: `Aucun métier ROME pour le code ${code}.` }],
          structuredContent: { trouve: false },
        };
      }
      const f = resumerFicheMetier(metier, fiche);
      const texte = [
        `${f.code} — ${f.libelle ?? "?"}${f.domaine ? ` (${f.domaine})` : ""}`,
        f.definition ? `\nDéfinition :\n${f.definition.slice(0, 1200)}` : "",
        f.accesEmploi ? `\nAccès à l'emploi : ${f.accesEmploi.slice(0, 600)}` : "",
        "",
        ...liste("Intitulés de poste", f.appellations, 15),
        ...liste("Compétences principales", f.competencesPrincipales),
        ...f.competencesParEnjeu.map((g) => liste(`Compétences — ${g.enjeu}`, g.competences, 8)[0]!),
        ...f.savoirsParCategorie.map((g) => liste(`Savoirs — ${g.categorie}`, g.savoirs, 15)[0]!),
        ...liste("Contextes de travail", f.contextesTravail),
      ]
        .filter((l) => l !== undefined)
        .join("\n");
      return {
        content: [{ type: "text", text: texte }],
        structuredContent: { trouve: true, fiche: f },
      };
    },
  );

  server.registerTool(
    "consulter_competence",
    {
      description:
        "Détail d'une compétence ou d'un savoir du ROME 4.0 par son code OGR (ex. renvoyé par `identifier_metier` " +
        "avec `type: competence`) : libellé, type, catégorie, correspondance ESCO.",
      inputSchema: {
        code: z.string().describe("Code OGR numérique, ex. 483972"),
      },
      outputSchema: { trouvee: z.boolean(), competence: z.any().optional() },
    },
    async ({ code }) => {
      const c = await lireCompetence(code);
      if (!c) {
        return {
          content: [{ type: "text", text: `Aucune compétence ROME pour le code ${code}.` }],
          structuredContent: { trouvee: false },
        };
      }
      const categorie = (c as any).categorieSavoir ?? (c as any).macroCompetence ?? (c as any).domaineCompetence;
      const texte = [
        `${c.libelle} [${c.code}]${c.type ? ` · ${c.type}` : ""}`,
        categorie?.libelle ? `Catégorie : ${categorie.libelle}${categorie.categorie?.libelle ? ` (${categorie.categorie.libelle})` : ""}` : "",
        c.definition ? `Définition : ${c.definition}` : "",
        c.competenceEsco?.libelle ? `ESCO : ${c.competenceEsco.libelle}${c.competenceEsco.uri ? ` — ${c.competenceEsco.uri}` : ""}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: [{ type: "text", text: texte }],
        structuredContent: { trouvee: true, competence: c },
      };
    },
  );
}
