import { MODULE_ID } from "../settings.js";
import { palierRequis, etat, ICONE, desHTML, bilan, mentions } from "./resultat.js";

/** Carte de chat : tous les participants avec portrait, jet, coche verte / croix rouge, et le bilan du groupe. */
export async function postChatRecap(payload) {
  const requis = palierRequis(payload);
  const gagnants = payload.winners?.winnerKeys ?? [];
  const lignes = [...payload.participants]
    .filter((p) => !p.pending)
    .sort((a, b) => (payload.teams ? a.team.localeCompare(b.team) : 0) || b.rank - a.rank || a.roll - b.roll)
    .map((p) => {
      const e = etat(p, payload);
      return {
        ...p,
        etat: e,
        icone: ICONE[e],
        jet: String(p.roll).padStart(2, "0"),
        niveau: game.i18n.localize(`ROLLENSEMBLECOC7.Level.${p.level}`),
        des: desHTML(p.dice),
        mentions: mentions(p, payload),
        gagnant: gagnants.includes(p.key) && payload.participants.length > 1
      };
    });
  const b = bilan(payload);
  const competence = payload.participants[0]?.skillLabel ?? "";
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/chat-recap.hbs`, {
    theme: payload.theme ?? "classique",
    label: payload.label,
    sous: [payload.label !== competence ? competence : "",
      requis !== null ? `${game.i18n.localize("ROLLENSEMBLECOC7.Banniere.Difficulte")} : ${game.i18n.localize(`ROLLENSEMBLECOC7.Level.${payload.difficulty}`)}` : ""]
      .filter(Boolean).join(" · "),
    teams: payload.teams,
    lignes,
    bilan: b,
    toutOk: b.groupe === true || (b.groupe === null && b.ok === b.total && !payload.teams),
    aucunOk: b.groupe === false || (b.groupe === null && b.ok === 0 && !payload.teams),
    adversaire: payload.adversaire ? { ...payload.adversaire, jet: String(payload.adversaire.roll).padStart(2, "0"), niveau: game.i18n.localize(`ROLLENSEMBLECOC7.Level.${payload.adversaire.level}`), cache: !!payload.adversaire.cache && !payload.cache } : null,
    regle: payload.regle && payload.regle !== "chacun" && !payload.teams ? game.i18n.localize(`ROLLENSEMBLECOC7.Regle.Nom.${payload.regle}`) : null
  });
  const gm = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker(),
    ...(payload.cache ? { whisper: gm, blind: true } : {}),
    flags: { [MODULE_ID]: { lancer: payload.id } }
  });
}
