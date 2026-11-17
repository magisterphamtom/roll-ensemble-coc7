/**
 * 01 et maladresses : cartes plein écran du module Critiques du Mythe, s'il est actif.
 * Plusieurs critiques dans un même lancer passent l'un après l'autre.
 */
import { MODULE_ID } from "../settings.js";

const CM = "critiques-du-mythe";
let file = Promise.resolve();

export function effetCritique({ kind, actorUuid, nom, img, libelle, resultat, graine }) {
  if (!game.settings.get(MODULE_ID, "effetsCritiques")) return;
  const mod = game.modules.get(CM);
  if (!mod?.active || !mod.api) return;
  file = file.then(async () => {
    try {
      let acteur = null;
      try { acteur = actorUuid ? await fromUuid(actorUuid) : null; } catch { acteur = null; }
      acteur = acteur?.actor ?? acteur;
      const donnees = { kind, acteur, nom: acteur?.name ?? nom, img: acteur?.img ?? img, libelle, resultat, graine };
      let affiche = true;
      if (mod.api.declencher) affiche = await mod.api.declencher(donnees);
      else {
        // Ancienne version de Critiques du Mythe : on respecte ses réglages à la main
        const g = (k) => game.settings.get(CM, k);
        affiche = g(kind === "critical" ? "critique" : "maladresse") && g("afficher") && (g("pnj") || !acteur || acteur.hasPlayerOwner);
        if (affiche) mod.api.afficher({ kind, theme: g("theme") === "auto" ? "jazz" : g("theme"), nom: donnees.nom, img: donnees.img, libelle, resultat, graine });
      }
      if (affiche) {
        const duree = Math.max(2, Number(game.settings.get(CM, "duree")) || 4);
        await new Promise((r) => setTimeout(r, duree * 1000 + 700));
      }
    } catch (e) {
      console.error(`${MODULE_ID} |`, e);
    }
  });
}
