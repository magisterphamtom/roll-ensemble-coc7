/** Choisit entre la bannière (par défaut) et l'ancienne fenêtre de spectateur. */
import { MODULE_ID } from "../settings.js";
import { Banniere } from "../apps/Banniere.js";
import { SpectatorApp } from "../apps/SpectatorApp.js";

export const enBanniere = () => game.settings.get(MODULE_ID, "affichage") !== "fenetre";

export function ouvrirAffichage(payload) {
  if (enBanniere()) Banniere.ouvrir(payload);
  else new SpectatorApp(payload).render(true);
}

export function appliquerResultat(data) {
  Banniere.appliquer(data);
  SpectatorApp.applyResult(data);
}

export function finaliserAffichage(payload) {
  Banniere.finaliser(payload);
  SpectatorApp.finalizeAny(payload);
}
