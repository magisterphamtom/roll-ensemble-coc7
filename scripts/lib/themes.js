/**
 * Thème de la bannière et de la carte de chat.
 * « Automatique » suit l'époque choisie avec Bascule d'époque (thème de chat réglé pour cette époque),
 * sinon le thème des cartes de chat actif, sinon Classique.
 */
import { MODULE_ID } from "../settings.js";

export const THEMES = ["classique", "annees20", "newyork", "montagnes", "ny2026", "antarctique2026"];

export function themeActif() {
  let choix = "auto";
  try { choix = game.settings.get(MODULE_ID, "theme"); } catch { /* pas encore enregistré */ }
  if (THEMES.includes(choix)) return choix;

  // 1. Bascule d'époque : le thème de chat associé à l'époque en cours
  if (game.modules.get("coc7-bascule-epoque")?.active) {
    try {
      const era = game.settings.get("coc7-bascule-epoque", "currentEra");
      const t = game.settings.get("coc7-bascule-epoque", "config")?.[era]?.chatTheme;
      if (THEMES.includes(t)) return t;
    } catch { /* réglages absents */ }
  }
  // 2. Thème des cartes de chat posé sur la page
  for (const t of THEMES) if (document.body.classList.contains(`c7cc-${t}`)) return t;
  return "classique";
}
