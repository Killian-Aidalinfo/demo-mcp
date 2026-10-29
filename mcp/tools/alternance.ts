/**
 * Tools MCP autour de l'API « La bonne alternance » (api.apprentissage.beta.gouv.fr) :
 * offres d'alternance, entreprises susceptibles de recruter et formations en apprentissage.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  rechercherOffresAlternance,
  consulterOffreAlternance,
  rechercherFormationsAlternance,
  resumerOffreAlternance,
  resumerRecruteur,
  resumerFormationAlternance,
  tronquer,
  type ResumeOffreAlternance,
  type AvertissementLba,
} from "../client/alternance";

const LONGUEUR_DESCRIPTION_DETAIL = 2000;

// Critères géographiques communs aux recherches d'offres et de formations.
const latitude = z
  .number()
  .min(-90)
  .max(90)
  .optional()
  .describe("Latitude du centre de recherche (à obtenir avec `localiser_commune`). Sans lat/lon : toute la France");
const longitude = z
  .number()
  .min(-180)
  .max(180)
  .optional()
  .describe("Longitude du centre de recherche (à obtenir avec `localiser_commune`)");
const rayonKm = z
  .number()
  .min(0)
  .max(200)
  .default(30)
  .describe("Rayon de recherche en km autour de lat/lon (0 à 200, défaut 30)");
const romes = z
  .string()
  .optional()
  .describe("Code(s) ROME séparés par des virgules (ex. « M1801,M1810 »)");
const rncp = z
  .string()
  .regex(/^RNCP\d{3,5}$/, "Format attendu : RNCP suivi de 3 à 5 chiffres (ex. RNCP35475)")
  .optional()
  .describe("Code de certification RNCP (ex. RNCP35475)");

const EXEMPLES_ROME =
  "Exemples de codes ROME infra : M1801 (administration de systèmes d'information), " +
  "M1810 (production et exploitation de SI), I1401 (maintenance informatique).";

function texteAvertissements(avertissements: AvertissementLba[]): string {
  if (!avertissements.length) return "";
  return (
    "\n\nAvertissements de l'API :\n" +
    avertissements.map((a) => `- [${a.code}] ${a.message}`).join("\n")
  );
}

function dateCourte(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

function ligneOffre(o: ResumeOffreAlternance, i: number): string {
  const details = [
    o.adresse,
    o.typeContrat,
    o.niveauVise,
    o.datePublication ? `publiée le ${dateCourte(o.datePublication)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    `${i + 1}. ${o.id ? `[${o.id}] ` : ""}${o.intitule ?? "—"} — ${o.entreprise ?? "?"}` +
    (details ? `\n   ${details}` : "") +
    (o.url ? `\n   ${o.url}` : "")
  );
}

const schemaResumeOffre = z.object({
  id: z.string().nullable(),
  source: z.string().nullable(),
  idPartenaire: z.string().nullable(),
  intitule: z.string().nullable(),
  entreprise: z.string().nullable(),
  adresse: z.string().nullable(),
  siret: z.string().nullable(),
  taille: z.string().nullable(),
  typeContrat: z.string().nullable(),
  debut: z.string().nullable(),
  dureeMois: z.number().nullable(),
  teletravail: z.string().nullable(),
  niveauVise: z.string().nullable(),
  codesRome: z.array(z.string()),
  datePublication: z.string().nullable(),
  dateExpiration: z.string().nullable(),
  url: z.string().nullable(),
  telephone: z.string().nullable(),
  description: z.string().nullable(),
});

const schemaAvertissement = z.object({ message: z.string(), code: z.string() });

export function enregistrerToolsAlternance(server: McpServer): void {
  server.registerTool(
    "rechercher_offres_alternance",
    {
      description:
        "Recherche des offres d'emploi en alternance (apprentissage / professionnalisation) via " +
        "l'API « La bonne alternance » (agrège France Travail, LBA et partenaires). Recherche par " +
        "coordonnées GPS : obtiens d'abord latitude/longitude avec l'outil `localiser_commune`. " +
        "Peut aussi lister des entreprises susceptibles de recruter sans offre publiée (candidature " +
        `spontanée) avec inclureRecruteurs=true. ${EXEMPLES_ROME} ` +
        "L'identifiant entre crochets [ID] est utilisable avec `consulter_offre_alternance` " +
        "(les offres France Travail n'en ont pas : utiliser leur lien).",
      inputSchema: {
        latitude,
        longitude,
        rayonKm,
        niveauDiplome: z
          .enum(["3", "4", "5", "6", "7"])
          .optional()
          .describe(
            "Niveau de diplôme visé : 3=CAP, 4=Bac, 5=Bac+2, 6=Bac+3/licence, 7=Bac+5. " +
              "Les offres au niveau non précisé sont aussi renvoyées",
          ),
        romes,
        rncp,
        departements: z
          .array(z.string())
          .optional()
          .describe("Numéros de départements (ex. [\"54\", \"57\"])"),
        inclureRecruteurs: z
          .boolean()
          .default(false)
          .describe("Inclure les entreprises susceptibles de recruter (sans offre publiée)"),
        maxResultats: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Nombre max d'offres (et de recruteurs) renvoyés"),
      },
      outputSchema: {
        total: z.number().describe("Nombre d'offres renvoyées par l'API"),
        offres: z.array(schemaResumeOffre),
        recruteurs: z.array(z.any()).optional(),
        avertissements: z.array(schemaAvertissement),
      },
    },
    async ({ latitude, longitude, rayonKm, niveauDiplome, romes, rncp, departements, inclureRecruteurs, maxResultats }) => {
      const resultat = await rechercherOffresAlternance({
        latitude,
        longitude,
        radius: rayonKm,
        target_diploma_level: niveauDiplome,
        romes,
        rncp,
        departements,
      });
      const offres = resultat.offres.slice(0, maxResultats).map((o) => resumerOffreAlternance(o));
      const recruteurs = inclureRecruteurs
        ? resultat.recruteurs.slice(0, maxResultats).map(resumerRecruteur)
        : undefined;

      let texte =
        `${offres.length} offre(s) affichée(s) sur ${resultat.offres.length} renvoyée(s) par l'API.\n\n` +
        offres.map(ligneOffre).join("\n");
      if (recruteurs) {
        texte +=
          `\n\n${recruteurs.length} entreprise(s) susceptible(s) de recruter (candidature spontanée) :\n` +
          recruteurs
            .map(
              (r, i) =>
                `${i + 1}. ${r.entreprise ?? "?"}${r.adresse ? ` — ${r.adresse}` : ""}` +
                (r.url ? `\n   ${r.url}` : ""),
            )
            .join("\n");
      }
      texte += texteAvertissements(resultat.avertissements);

      return {
        content: [{ type: "text", text: texte }],
        structuredContent: {
          total: resultat.offres.length,
          offres,
          ...(recruteurs ? { recruteurs } : {}),
          avertissements: resultat.avertissements,
        },
      };
    },
  );

  server.registerTool(
    "consulter_offre_alternance",
    {
      description:
        "Consulte le détail d'une offre d'alternance « La bonne alternance » par son identifiant " +
        "(obtenu avec `rechercher_offres_alternance`) : description, compétences, contrat, lien de candidature.",
      inputSchema: {
        id: z.string().describe("Identifiant LBA de l'offre"),
      },
      outputSchema: {
        trouvee: z.boolean(),
        offre: schemaResumeOffre.optional(),
        competencesAttendues: z.array(z.string()).optional(),
        competencesAcquises: z.array(z.string()).optional(),
        conditionsAcces: z.array(z.string()).optional(),
        nombrePostes: z.number().nullable().optional(),
        siteWeb: z.string().nullable().optional(),
        presentationEntreprise: z.string().nullable().optional(),
      },
    },
    async ({ id }) => {
      const brute = await consulterOffreAlternance(id);
      if (!brute) {
        return {
          content: [{ type: "text", text: `Aucune offre d'alternance trouvée pour l'identifiant ${id}.` }],
          structuredContent: { trouvee: false },
        };
      }
      const offre = resumerOffreAlternance(brute, LONGUEUR_DESCRIPTION_DETAIL);
      const competencesAttendues = brute.offer?.desired_skills ?? [];
      const competencesAcquises = brute.offer?.to_be_acquired_skills ?? [];
      const conditionsAcces = brute.offer?.access_conditions ?? [];
      const presentationEntreprise = tronquer(brute.workplace?.description, 600);
      const liste = (titre: string, items: string[]) =>
        items.length ? `\n\n${titre} :\n${items.map((c) => `- ${c}`).join("\n")}` : "";

      const texte =
        `${offre.intitule ?? "—"} [${offre.id ?? id}]\n` +
        `Entreprise : ${offre.entreprise ?? "—"}${offre.taille ? ` (${offre.taille} salariés)` : ""}\n` +
        `Adresse : ${offre.adresse ?? "—"}\n` +
        `Contrat : ${offre.typeContrat ?? "—"}` +
        `${offre.dureeMois ? `, ${offre.dureeMois} mois` : ""}` +
        `${offre.debut ? `, début ${dateCourte(offre.debut)}` : ""}` +
        `${offre.teletravail ? `, ${offre.teletravail}` : ""}\n` +
        `Niveau visé : ${offre.niveauVise ?? "—"}\n` +
        `Publication : ${dateCourte(offre.datePublication) ?? "—"} (expire ${dateCourte(offre.dateExpiration) ?? "—"})\n` +
        `Candidater : ${offre.url ?? "—"}${offre.telephone ? ` · tél. ${offre.telephone}` : ""}\n\n` +
        `${offre.description ?? ""}` +
        liste("Compétences attendues", competencesAttendues) +
        liste("Compétences à acquérir", competencesAcquises) +
        liste("Conditions d'accès", conditionsAcces);

      return {
        content: [{ type: "text", text: texte }],
        structuredContent: {
          trouvee: true,
          offre,
          competencesAttendues,
          competencesAcquises,
          conditionsAcces,
          nombrePostes: brute.offer?.opening_count ?? null,
          siteWeb: brute.workplace?.website ?? null,
          presentationEntreprise,
        },
      };
    },
  );

  server.registerTool(
    "rechercher_formations_alternance",
    {
      description:
        "Recherche des formations en apprentissage (CFA, écoles) via l'API « La bonne alternance ». " +
        "Recherche par coordonnées GPS : obtiens d'abord latitude/longitude avec l'outil `localiser_commune`. " +
        EXEMPLES_ROME,
      inputSchema: {
        latitude,
        longitude,
        rayonKm,
        niveauDiplome: z
          .enum(["1", "2", "3", "4", "5", "6", "7", "8"])
          .optional()
          .describe("Niveau européen du diplôme visé : 3=CAP, 4=Bac, 5=Bac+2, 6=Bac+3/licence, 7=Bac+5, 8=doctorat"),
        romes,
        rncp,
        maxResultats: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(50)
          .describe("Nombre max de formations renvoyées"),
      },
      outputSchema: {
        total: z.number().describe("Nombre de formations renvoyées"),
        nombrePages: z.number().nullable(),
        formations: z.array(z.any()),
      },
    },
    async ({ latitude, longitude, rayonKm, niveauDiplome, romes, rncp, maxResultats }) => {
      const resultat = await rechercherFormationsAlternance({
        latitude,
        longitude,
        radius: rayonKm,
        target_diploma_level: niveauDiplome,
        romes,
        rncp,
        page_size: maxResultats,
      });
      const formations = resultat.formations.slice(0, maxResultats).map(resumerFormationAlternance);
      const apercu = formations
        .map((f, i) => {
          const details = [
            f.niveau,
            f.adresse,
            f.sessions[0]?.debut ? `prochaine session ${dateCourte(f.sessions[0].debut)}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            `${i + 1}. ${f.intitule ?? "—"} — ${f.organisme ?? "?"}` +
            (details ? `\n   ${details}` : "") +
            (f.url ? `\n   ${f.url}` : "")
          );
        })
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${formations.length} formation(s) en apprentissage trouvée(s).\n\n${apercu}`,
          },
        ],
        structuredContent: {
          total: formations.length,
          nombrePages: resultat.pagination.page_count ?? null,
          formations,
        },
      };
    },
  );
}
