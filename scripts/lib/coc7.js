export const RANK = {
  fumble: 0,
  fail: 1,
  regular: 2,
  hard: 3,
  extreme: 4,
  critical: 5
};

export const LEVEL_COLOR = {
  fumble: "#8b0000",
  fail: "#888888",
  regular: "#2ecc71",
  hard: "#3498db",
  extreme: "#9b59b6",
  critical: "#ffd700"
};

/**
 * Lance 1d100 en tenant compte des dés bonus/malus (règles CoC7).
 * Un d10 des unités est fixe ; on lance un d10 des dizaines supplémentaire
 * par dé net (bonus - malus), et on garde le plus favorable (le plus bas
 * pour un bonus, le plus haut pour un malus).
 * @param {number} bonusDice
 * @param {number} penaltyDice
 * @returns {{roll: number, unit: number, tensRolled: number[], net: number}}
 */
export function rollPercentile(bonusDice = 0, penaltyDice = 0) {
  const net = (bonusDice || 0) - (penaltyDice || 0);
  const extraDice = Math.abs(net);
  const unit = Math.floor(Math.random() * 10);
  const tensRolled = [];
  for (let i = 0; i <= extraDice; i++) tensRolled.push(Math.floor(Math.random() * 10));

  let tens;
  if (net > 0) tens = Math.min(...tensRolled);
  else if (net < 0) tens = Math.max(...tensRolled);
  else tens = tensRolled[0];

  let roll = tens * 10 + unit;
  if (roll === 0) roll = 100;

  return { roll, unit, tensRolled, net };
}

/**
 * Détermine le palier de réussite CoC7 pour un jet donné.
 * @param {number} roll  résultat du d100 (1-100)
 * @param {number} skill  valeur de compétence effective (après modificateurs)
 * @returns {"fumble"|"fail"|"regular"|"hard"|"extreme"|"critical"}
 */
export function successLevel(roll, skill) {
  if (roll === 1) return "critical";
  if (roll === 100 || (skill < 50 && roll >= 96)) return "fumble";
  if (roll <= Math.floor(skill / 5)) return "extreme";
  if (roll <= Math.floor(skill / 2)) return "hard";
  if (roll <= skill) return "regular";
  return "fail";
}

/**
 * Détermine le(s) vainqueur(s) d'un lancer groupé CoC7.
 * Individuel : tous les participants au palier de réussite le plus élevé.
 * Équipes : compare le meilleur palier de chaque équipe ; égalité de palier
 * tranchée par la compétence effective la plus haute, sinon égalité réelle.
 * @param {Array} participants  chacun avec {key, team, rank, effectiveSkill}
 * @param {boolean} teams
 */
export function determineWinners(participants, teams) {
  if (!participants.length) return { mode: teams ? "teams" : "individual", winnerKeys: [] };

  if (teams) {
    const teamA = participants.filter(p => p.team === "A");
    const teamB = participants.filter(p => p.team === "B");
    const bestOf = (team) => team.reduce((best, p) => (p.rank > (best?.rank ?? -1) ? p : best), null);
    const bestA = bestOf(teamA);
    const bestB = bestOf(teamB);
    let winningTeam = "tie";
    if ((bestA?.rank ?? -1) > (bestB?.rank ?? -1)) winningTeam = "A";
    else if ((bestB?.rank ?? -1) > (bestA?.rank ?? -1)) winningTeam = "B";
    else if (bestA && bestB) {
      if (bestA.effectiveSkill > bestB.effectiveSkill) winningTeam = "A";
      else if (bestB.effectiveSkill > bestA.effectiveSkill) winningTeam = "B";
    }
    const winnerKeys = [];
    if (winningTeam === "A" && bestA) winnerKeys.push(bestA.key);
    if (winningTeam === "B" && bestB) winnerKeys.push(bestB.key);
    return { mode: "teams", winnerKeys, winningTeam };
  }

  const bestRank = Math.max(...participants.map(p => p.rank));
  const winnerKeys = participants.filter(p => p.rank === bestRank).map(p => p.key);
  return { mode: "individual", winnerKeys };
}

export function makeRollId() {
  return foundry.utils.randomID(12);
}
