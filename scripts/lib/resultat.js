import { RANK } from "./coc7.js";

const L = (k, d) => (d ? game.i18n.format(`ROLLENSEMBLECOC7.${k}`, d) : game.i18n.localize(`ROLLENSEMBLECOC7.${k}`));

/** Palier minimum demandé (null = aucune difficulté : une réussite normale suffit). */
export function palierRequis(payload) {
  return payload?.difficulty && payload.difficulty !== "none" ? RANK[payload.difficulty] : null;
}

/** Valeur à atteindre (ou faire moins) pour le palier demandé. */
export function seuilValeur(p, payload) {
  const v = p.effectiveSkill ?? 0;
  switch (payload?.difficulty) {
    case "extreme": return Math.floor(v / 5);
    case "hard": return Math.floor(v / 2);
    default: return v;
  }
}

/**
 * Jet d'opposition contre l'adversaire (règle CoC7) : le meilleur palier gagne ;
 * à palier égal, la plus haute valeur de compétence ; sinon égalité.
 */
export function versus(p, adv) {
  if (!adv || adv.roll == null || p.roll == null) return null;
  if (p.rank !== adv.rank) return p.rank > adv.rank ? "gagne" : "perd";
  if (p.rank <= RANK.fail) return "perd"; // deux échecs : personne ne l'emporte, l'investigateur n'obtient rien
  if (p.effectiveSkill !== adv.effectiveSkill) return p.effectiveSkill > adv.effectiveSkill ? "gagne" : "perd";
  return "egal";
}

/** Le jet compte-t-il comme réussi (selon la difficulté, ou contre l'adversaire) ? */
export function estReussi(p, payloadOuRequis) {
  if (p.pending || p.rank == null || p.rank < 0) return null;
  if (payloadOuRequis && typeof payloadOuRequis === "object") {
    const payload = payloadOuRequis;
    if (payload.adversaire) return versus(p, payload.adversaire) === "gagne";
    return p.rank >= (palierRequis(payload) ?? RANK.regular);
  }
  return p.rank >= (payloadOuRequis ?? RANK.regular);
}

/** Classe d'état : crit (01), fumble (maladresse), ok (réussi), ko (raté). */
export function etat(p, payloadOuRequis) {
  if (p.level === "critical") return "crit";
  if (p.level === "fumble") return "fumble";
  return estReussi(p, payloadOuRequis) ? "ok" : "ko";
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

/**
 * Points de Chance qu'il faudrait dépenser pour réussir de justesse ce jet raté
 * (null si la Chance ne peut pas servir ici : réussite, maladresse, jet poussé, Chance/SAN, adversaire…).
 */
export function coutChance(p, payload) {
  if (!payload?.rattrapage || payload.cache || p.pending || p.roll == null) return null;
  if (p.level === "fumble" || estReussi(p, payload) || p.pushed || p.luckSpent || p.noSkill) return null;
  if (payload.skillKind === "special" || payload.adversaire) return null;
  const cout = p.roll - seuilValeur(p, payload);
  return cout > 0 ? cout : null;
}

/** Ce qu'un participant peut encore faire après son jet : pousser, dépenser de la Chance. */
export function options(p, payload, chanceDispo = null) {
  const r = { pousser: false, chance: null };
  if (!payload?.rattrapage || payload.cache || p.pending || p.roll == null || p.resolu) return r;
  if (p.level === "fumble" || estReussi(p, payload)) return r;
  const kind = payload.skillKind;
  if (kind === "special") return r; // pas de jet poussé ni de Chance sur la Chance ou la SAN
  r.pousser = !p.pushed && !p.luckSpent;
  if (!payload.adversaire && !p.pushed && !p.noSkill && chanceDispo != null) {
    const cout = p.roll - seuilValeur(p, payload);
    if (cout > 0 && cout <= chanceDispo) r.chance = cout;
  }
  return r;
}

/** Faut-il une phase de rattrapage (quelqu'un peut pousser ou dépenser de la Chance) ? */
export function aDesOptions(payload, chanceDe) {
  return payload.participants.some((p) => {
    const o = options(p, payload, chanceDe(p));
    return o.pousser || o.chance;
  });
}

/** Bilan d'un lancer terminé : réussites, verdict du groupe (règle choisie), équipe gagnante. */
export function bilan(payload) {
  const faits = payload.participants.filter((p) => !p.pending);
  const ok = faits.filter((p) => estReussi(p, payload)).length;
  const total = faits.length;
  const w = payload.winners;
  let verdict = "", groupe = null;
  if (payload.teams && w) {
    verdict = w.winningTeam === "A" ? L("Spectator.TeamAWins") : w.winningTeam === "B" ? L("Spectator.TeamBWins") : L("Spectator.Tie");
  } else if (total) {
    const regle = payload.regle ?? "chacun";
    if (regle === "un") groupe = ok >= 1;
    else if (regle === "tous") groupe = ok === total;
    else if (regle === "majorite") groupe = ok > total / 2;
    if (groupe !== null) verdict = L(groupe ? `Regle.Ok.${regle}` : `Regle.Ko.${regle}`, { ok, total });
    else if (ok === total) verdict = L(total > 1 ? "Bilan.Tous" : "Bilan.Reussi");
    else if (ok === 0) verdict = L(total > 1 ? "Bilan.Aucun" : "Bilan.Rate");
    else verdict = L("Bilan.Certains", { ok, total });
  }
  return { ok, total, verdict, groupe };
}

/** Petites mentions sous un résultat : jet poussé, Chance dépensée, perte de SAN, opposition. */
export function mentions(p, payload) {
  const m = [];
  if (p.pushed) m.push({ cls: p.level === "fumble" || !estReussi(p, payload) ? "re-m-pousse-rate" : "re-m-pousse", icone: "fa-solid fa-hand-fist", texte: L(estReussi(p, payload) ? "Rattrapage.Pousse" : "Rattrapage.PousseRate") });
  if (p.luckSpent) m.push({ cls: "re-m-chance", icone: "fa-solid fa-clover", texte: p.luckRestant != null ? L("Rattrapage.ChanceDepenseeReste", { n: p.luckSpent, reste: p.luckRestant }) : L("Rattrapage.ChanceDepensee", { n: p.luckSpent }) });
  if (payload.adversaire) {
    const v = versus(p, payload.adversaire);
    if (v) m.push({ cls: `re-m-${v}`, icone: v === "gagne" ? "fa-solid fa-trophy" : v === "egal" ? "fa-solid fa-equals" : "fa-solid fa-shield-halved", texte: L(`Adversaire.${v}`, { nom: payload.adversaire.name }) });
  }
  if (p.perte) m.push({ cls: "re-m-san", icone: "fa-solid fa-brain", texte: L(p.perte >= 5 ? "San.PerteGrosse" : "San.Perte", { n: p.perte }) });
  if (p.xp) m.push({ cls: "re-m-xp", icone: "fa-solid fa-graduation-cap", texte: L("Xp.Coche") });
  return m;
}

/** Graine commune à tous les clients (même phrase de Critiques du Mythe partout). */
export function graine(texte) {
  let h = 0;
  for (const c of String(texte)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
