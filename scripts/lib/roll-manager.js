/**
 * Côté Gardien : suit chaque lancer de groupe jusqu'au bout.
 * 1. jets (les joueurs lancent, ou le Gardien pour tous)
 * 2. rattrapage (pousser le jet ou dépenser de la Chance, si quelqu'un le peut)
 * 3. fin : vainqueurs, perte de SAN, cases d'expérience, carte de chat, verdict chez tout le monde
 */
import { MODULE_ID } from "../settings.js";
import { determineWinners, RANK } from "./coc7.js";
import { broadcast } from "./socket.js";
import { postChatRecap } from "./chat-recap.js";
import { finaliserAffichage, ouvrirRattrapage } from "./affichage.js";
import { aDesOptions } from "./resultat.js";
import { getSkillItemByLabel, getLuckValue } from "./actor-skills.js";

/** @type {Map<string, {payload: object, attendus: Set<string>, etape: string}>} */
const lancers = new Map();

/** Valeur de Chance actuelle d'un participant (pour savoir s'il peut en dépenser). */
export function chanceDe(p) {
  let a = null;
  try { a = fromUuidSync(p.actorUuid); } catch { a = null; }
  a = a?.actor ?? a;
  return a ? getLuckValue(a) : null;
}

export function registerRoll(payload, attendus = []) {
  lancers.set(payload.id, { payload, attendus: new Set(attendus), etape: "jets" });
}
export const registerPendingRoll = registerRoll;

/** Réponse d'un joueur (ou du Gardien depuis la bannière). */
export async function handleRollResponse(data) {
  const e = lancers.get(data.rollId);
  if (!e || e.etape !== "jets" || !e.attendus.has(data.key)) return;
  const p = e.payload.participants.find((x) => x.key === data.key);
  if (!p) return;
  Object.assign(p, { roll: data.roll, level: data.level, rank: data.rank, rangJet: data.rank, meetsThreshold: data.meetsThreshold, pending: false });
  e.attendus.delete(data.key);
  if (e.attendus.size === 0) await apresJets(data.rollId);
}

/** Tous les jets sont faits : rattrapage si quelqu'un peut pousser ou dépenser de la Chance, sinon fin. */
export async function apresJets(id) {
  const e = lancers.get(id);
  if (!e || e.etape !== "jets") return;
  if (e.payload.rattrapage && aDesOptions(e.payload, chanceDe)) {
    e.etape = "rattrapage";
    broadcast("rattrapage", { id });
    ouvrirRattrapage(id);
    return;
  }
  await finaliserLancer(id);
}

/** Un participant a poussé son jet, dépensé de la Chance ou accepté son résultat. */
export async function handleAjustement(data) {
  const e = lancers.get(data.id);
  if (!e || e.etape !== "rattrapage") return;
  const p = e.payload.participants.find((x) => x.key === data.key);
  // (sur le poste du Gardien, la bannière partage ce même objet et l'a peut-être déjà mis à jour)
  if (!p || e.traites?.has(data.key)) return;
  (e.traites ??= new Set()).add(data.key);
  Object.assign(p, data.changes, { resolu: true });
  if (!aDesOptions(e.payload, chanceDe)) await finaliserLancer(data.id);
}

/** Le Gardien clôt le lancer tout de suite (bouton « Valider »). */
export async function forcerFin(id) {
  const e = lancers.get(id);
  if (!e || e.etape === "fini") return;
  await finaliserLancer(id);
}

export async function finaliserLancer(id) {
  const e = lancers.get(id);
  if (!e || e.etape === "fini") return;
  e.etape = "fini";
  const payload = e.payload;
  const faits = payload.participants.filter((p) => !p.pending);
  payload.winners = determineWinners(faits, payload.teams);
  payload.fini = true;
  try { await appliquerPertesSan(payload); } catch (err) { console.error(`${MODULE_ID} | SAN`, err); }
  try { await cocherExperience(payload); } catch (err) { console.error(`${MODULE_ID} | expérience`, err); }
  broadcast("results-final", payload);
  finaliserAffichage(payload);
  await postChatRecap(payload);
  lancers.delete(id);
}

/* ------------------------------------------------------------------ */

async function acteur(uuid) {
  let a = null;
  try { a = uuid ? await fromUuid(uuid) : null; } catch { a = null; }
  return a?.actor ?? a;
}

/** Jet de SAN de groupe : tire et retire la perte (maladresse = perte maximale). */
async function appliquerPertesSan(payload) {
  const ps = payload.perteSan;
  if (payload.skillKind !== "special" || payload.skillKey !== "san" || !ps) return;
  for (const p of payload.participants) {
    if (p.pending || p.roll == null) continue;
    const reussi = p.rank >= RANK.regular;
    const formule = String((reussi ? ps.ok : ps.ko) || "0").trim();
    let perte = 0;
    if (formule && formule !== "0" && Roll.validate(formule)) {
      const r = await new Roll(formule).evaluate(p.level === "fumble" ? { maximize: true } : {});
      perte = Math.max(0, r.total);
    }
    p.perte = perte;
    if (!perte) continue;
    const a = await acteur(p.actorUuid);
    const san = a?.system?.attribs?.san;
    if (!san) continue;
    const max = Number(san.max) || 99;
    await a.update({ "system.attribs.san.value": Math.max(0, Math.min(max, (Number(san.value) || 0) - perte)) });
  }
}

/**
 * Case d'expérience cochée sur une réussite au premier jet, comme un jet normal de CoC7.
 * Règle : pas d'expérience si la réussite vient d'un jet poussé ou de la Chance dépensée.
 */
async function cocherExperience(payload) {
  if (!payload.experience || payload.skillKind !== "skill" || payload.cache) return;
  try { if (!game.settings.get("CoC7", "xpEnabled")) return; } catch { /* autre système : on coche quand même */ }
  for (const p of payload.participants) {
    if (p.pending || p.pushed || p.luckSpent || (p.rangJet ?? p.rank) < RANK.regular) continue;
    const a = await acteur(p.actorUuid);
    const item = getSkillItemByLabel(a, payload.skillLabel);
    if (!item || item.system?.properties?.noxpgain) continue;
    if (!item.system?.flags?.developement) await item.update({ "system.flags.developement": true });
    p.xp = true;
  }
}
