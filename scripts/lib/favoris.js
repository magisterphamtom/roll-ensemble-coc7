/**
 * Lancers favoris : une macro qui relance le même lancer de groupe en un clic.
 * Clic : la bannière part (demande aux joueurs connectés, sinon le Gardien lance).
 * Maj + clic : ouvre la fenêtre de préparation déjà remplie.
 */
import { MODULE_ID } from "../settings.js";

export async function creerMacroFavori(favori, nom) {
  const titre = nom || game.i18n.localize("ROLLENSEMBLECOC7.ChatButton");
  const command = `// Roll Ensemble — CoC7 : lancer favori « ${titre.replace(/[\r\n]/g, " ")} »
// Clic : lancer · Maj + clic : ouvrir la préparation
const api = game.modules.get("${MODULE_ID}")?.api;
if (!api) return ui.notifications.warn("Roll Ensemble — CoC7 n'est pas actif.");
api.lancerFavori(${JSON.stringify(favori)}, { ouvrir: !!(typeof event !== "undefined" && event?.shiftKey) });`;
  const macro = await Macro.create({ name: titre, type: "script", img: "icons/svg/d20-highlight.svg", command });
  // Dans la barre de macros, à la première place libre
  try {
    const libre = Array.from({ length: 50 }, (_, i) => i + 1).find((s) => !game.user.hotbar?.[s]);
    if (libre) await game.user.assignHotbarMacro(macro, libre);
  } catch { /* barre pleine : la macro reste dans le dossier des macros */ }
  ui.notifications.info(game.i18n.format("ROLLENSEMBLECOC7.Favori.Cree", { nom: titre }));
  return macro;
}
