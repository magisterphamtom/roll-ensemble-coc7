import { determineWinners } from "./coc7.js";
import { broadcast } from "./socket.js";
import { postChatRecap } from "./chat-recap.js";
import { SpectatorApp } from "../apps/SpectatorApp.js";

/** @type {Map<string, {payload: object, pendingKeys: Set<string>}>} */
const pendingRolls = new Map();

/**
 * Enregistre un lancer groupé encore incomplet (des participants attendent
 * la réponse d'un joueur) pour que le MJ puisse le finaliser plus tard.
 */
export function registerPendingRoll(payload, pendingKeys) {
  pendingRolls.set(payload.id, { payload, pendingKeys: new Set(pendingKeys) });
}

/**
 * Appelé sur le client du MJ à chaque réponse de jet reçue d'un joueur.
 * Finalise automatiquement (calcule les vainqueurs, diffuse, poste le récap)
 * une fois que tous les participants en attente ont répondu.
 */
export async function handleRollResponse(data) {
  const entry = pendingRolls.get(data.rollId);
  if (!entry) return;
  if (!entry.pendingKeys.has(data.key)) return; // déjà traité (double réponse)

  const participant = entry.payload.participants.find(p => p.key === data.key);
  if (!participant) return;

  Object.assign(participant, {
    roll: data.roll,
    level: data.level,
    rank: data.rank,
    meetsThreshold: data.meetsThreshold,
    pending: false
  });
  entry.pendingKeys.delete(data.key);

  if (entry.pendingKeys.size === 0) {
    entry.payload.winners = determineWinners(entry.payload.participants, entry.payload.teams);
    broadcast("results-final", entry.payload);
    SpectatorApp.finalizeAny(entry.payload); // le MJ ne reçoit pas ses propres broadcasts
    await postChatRecap(entry.payload);
    pendingRolls.delete(data.rollId);
  }
}
