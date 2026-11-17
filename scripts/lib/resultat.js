import { RANK } from "./coc7.js";

/** Palier minimum demandé (null = aucune difficulté : une réussite normale suffit). */
export function palierRequis(payload) {
  return payload?.difficulty && payload.difficulty !== "none" ? RANK[payload.difficulty] : null;
}

/** Le jet est-il réussi ? Avec une difficulté : le palier doit l'atteindre ; sans : réussite normale ou mieux. */
export function estReussi(p, requis) {
  if (p.pending || p.rank == null || p.rank < 0) return null;
  return p.rank >= (requis ?? RANK.regular);
}

/** Classe d'état d'un résultat : crit (01), fumble (maladresse), ok (réussi), ko (raté). */
export function etat(p, requis) {
  if (p.level === "critical") return "crit";
  if (p.level === "fumble") return "fumble";
  return estReussi(p, requis) ? "ok" : "ko";
}

export const ICONE = {
  crit: "fa-solid fa-star",
  fumble: "fa-solid fa-skull",
  ok: "fa-solid fa-circle-check",
  ko: "fa-solid fa-circle-xmark"
};

/** Petits dés bonus (verts) ou malus (rouges) en HTML. */
export function desHTML(dice) {
  const n = Math.abs(Number(dice) || 0);
  if (!n) return "";
  const cls = dice > 0 ? "re-de-bonus" : "re-de-malus";
  const titre = game.i18n.localize(`ROLLENSEMBLECOC7.Config.Dice.${dice > 0 ? "P" : "M"}${n}`);
  return `<span class="re-des ${cls}" title="${titre}">${'<i class="fa-solid fa-dice-d10"></i>'.repeat(n)}</span>`;
}

/** Bilan d'un lancer terminé : nombre de réussites, texte du verdict. */
export function bilan(payload) {
  const requis = palierRequis(payload);
  const faits = payload.participants.filter((p) => !p.pending);
  const ok = faits.filter((p) => estReussi(p, requis)).length;
  const L = (k, d) => (d ? game.i18n.format(`ROLLENSEMBLECOC7.${k}`, d) : game.i18n.localize(`ROLLENSEMBLECOC7.${k}`));
  let verdict = "";
  const w = payload.winners;
  if (payload.teams && w) {
    verdict = w.winningTeam === "A" ? L("Spectator.TeamAWins") : w.winningTeam === "B" ? L("Spectator.TeamBWins") : L("Spectator.Tie");
  } else if (faits.length) {
    if (ok === faits.length) verdict = L(faits.length > 1 ? "Bilan.Tous" : "Bilan.Reussi");
    else if (ok === 0) verdict = L(faits.length > 1 ? "Bilan.Aucun" : "Bilan.Rate");
    else verdict = L("Bilan.Certains", { ok, total: faits.length });
  }
  return { ok, total: faits.length, verdict };
}

/** Graine commune à tous les clients (même phrase de Critiques du Mythe partout). */
export function graine(texte) {
  let h = 0;
  for (const c of String(texte)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
