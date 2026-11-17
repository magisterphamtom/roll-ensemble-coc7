/**
 * Bannière de lancer de groupe, affichée chez tout le monde (à la manière d'Epic Rolls) :
 * le dé à lancer, les portraits des participants, et chaque joueur lance depuis son portrait.
 */
import { MODULE_ID } from "../settings.js";
import { rollPercentile, successLevel, RANK, LEVEL_COLOR } from "../lib/coc7.js";
import { broadcast } from "../lib/socket.js";
import { handleRollResponse } from "../lib/roll-manager.js";
import { effetCritique } from "../lib/effets.js";
import { palierRequis, etat, ICONE, desHTML, bilan, graine } from "../lib/resultat.js";

const L = (k, d) => (d ? game.i18n.format(`ROLLENSEMBLECOC7.${k}`, d) : game.i18n.localize(`ROLLENSEMBLECOC7.${k}`));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const pad = (n) => String(n).padStart(2, "0");
const jouer = (src) => src && foundry.audio.AudioHelper.play({ src, volume: 0.8, autoplay: true, loop: false }, false);

/** Un d10 « des pourcentages » dessiné (trapézoèdre vu de face). */
const DE = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <polygon class="re-de-face" points="50,4 94,40 80,92 20,92 6,40"/>
  <polyline class="re-de-arete" points="6,40 50,56 94,40"/><line class="re-de-arete" x1="50" y1="56" x2="50" y2="4"/>
  <line class="re-de-arete" x1="50" y1="56" x2="20" y2="92"/><line class="re-de-arete" x1="50" y1="56" x2="80" y2="92"/>
  <text x="50" y="80" text-anchor="middle">%</text></svg>`;

let courante = null;

export class Banniere {
  static ouvrir(payload) {
    courante?.fermer(true);
    courante = new Banniere(payload);
  }

  static appliquer(data) {
    if (courante?.payload.id === data.rollId) courante.reveler(data);
  }

  static finaliser(payload) {
    if (courante?.payload.id === payload.id) courante.finaliser(payload);
  }

  constructor(payload) {
    this.payload = payload;
    this.requis = palierRequis(payload);
    this.reveles = new Map(); // clé → valeur affichée
    this.effets = new Set(); // clés dont l'effet critique a été joué
    this.tourne = new Map(); // clé → minuterie du défilement
    this.fini = false;
    this.#construire();
    this.#animer();
  }

  /* ---------------------------------------------------------------- */

  #peutLancer(p) {
    if (!p.pending) return false;
    let acteur = null;
    try { acteur = fromUuidSync(p.actorUuid); } catch { acteur = null; }
    return !!(acteur?.isOwner || game.user.isGM);
  }

  #carte(p) {
    const lancer = this.#peutLancer(p);
    const moi = lancer && !game.user.isGM;
    const zone = p.pending
      ? lancer
        ? `<button type="button" class="re-b-lancer ${moi ? "re-b-moi" : ""}" data-key="${p.key}"><i class="fa-solid fa-dice-d10"></i> ${L(moi ? "Banniere.Lancer" : "Banniere.LancerMJ")}</button>`
        : `<span class="re-b-attente"><i class="fa-solid fa-hourglass-half"></i> ${L("Banniere.Attente")}</span>`
      : `<span class="re-b-valeur">--</span>`;
    return `<div class="re-b-carte ${moi ? "re-b-a-moi" : ""} ${p.pending ? "re-b-en-attente" : ""}" data-key="${p.key}">
      <div class="re-b-portrait"><img src="${esc(p.img)}" alt=""><i class="re-b-couronne fa-solid fa-crown"></i></div>
      <div class="re-b-nom">${esc(p.name)}</div>
      <div class="re-b-cible">${p.effectiveSkill} %${desHTML(p.dice)}</div>
      ${p.noSkill ? `<div class="re-b-note">${L("Config.NoSkillOnSheet")}</div>` : ""}
      <div class="re-b-zone">${zone}</div>
      <div class="re-b-etat"></div>
    </div>`;
  }

  #construire() {
    const { label, participants, teams } = this.payload;
    const competence = participants[0]?.skillLabel ?? "";
    const diff = this.payload.difficulty && this.payload.difficulty !== "none" ? L(`Level.${this.payload.difficulty}`) : "";
    const sous = [label !== competence ? competence : "", diff ? `${L("Banniere.Difficulte")} : ${diff}` : ""].filter(Boolean).join(" · ");
    const des = participants.map((p) => Number(p.dice) || 0);
    const memeDes = des.every((d) => d === des[0]) ? desHTML(des[0]) : "";

    let cartes;
    if (teams) {
      const groupe = (t) => participants.filter((p) => p.team === t).map((p) => this.#carte(p)).join("");
      cartes = `<div class="re-b-equipe" data-team="A"><div class="re-b-equipe-nom">${L("Config.TeamA")}</div><div class="re-b-rang">${groupe("A")}</div></div>
        <div class="re-b-vs">VS</div>
        <div class="re-b-equipe" data-team="B"><div class="re-b-equipe-nom">${L("Config.TeamB")}</div><div class="re-b-rang">${groupe("B")}</div></div>`;
    } else cartes = `<div class="re-b-rang">${participants.map((p) => this.#carte(p)).join("")}</div>`;

    const el = document.createElement("div");
    el.id = "re-banniere";
    el.className = `re-banniere ${teams ? "re-b-equipes" : ""}`;
    el.innerHTML = `<div class="re-b-bande">
        <button type="button" class="re-b-fermer" title="${L("Spectator.Close")}"><i class="fa-solid fa-xmark"></i></button>
        <div class="re-b-tete">
          <div class="re-b-de">${DE}</div>
          <div class="re-b-titres">
            <div class="re-b-kicker">${L("Banniere.Kicker")}${memeDes}</div>
            <h2>${esc(label)}</h2>
            ${sous ? `<div class="re-b-sous">${esc(sous)}</div>` : ""}
          </div>
        </div>
        <div class="re-b-cartes">${cartes}</div>
        <div class="re-b-verdict"></div>
      </div>`;
    el.querySelector(".re-b-fermer").addEventListener("click", () => this.fermer());
    el.querySelectorAll(".re-b-lancer").forEach((b) => b.addEventListener("click", () => this.#lancer(b)));
    document.body.append(el);
    this.el = el;
    requestAnimationFrame(() => el.classList.add("re-b-visible"));
  }

  #ligne(key) {
    return this.el?.querySelector(`.re-b-carte[data-key="${key}"]`);
  }

  #faireTourner(key) {
    const v = this.#ligne(key)?.querySelector(".re-b-zone");
    if (!v) return;
    v.innerHTML = `<span class="re-b-valeur re-b-tourne">--</span>`;
    const span = v.firstElementChild;
    this.tourne.set(key, setInterval(() => { span.textContent = pad(Math.ceil(Math.random() * 100)); }, 60));
  }

  #arreter(key) {
    clearInterval(this.tourne.get(key));
    this.tourne.delete(key);
  }

  async #animer() {
    const { participants, rollDurationMs, staggerMs, playSound, soundRoll } = this.payload;
    const resolus = participants.filter((p) => !p.pending);
    if (playSound && resolus.length) jouer(soundRoll);
    resolus.forEach((p) => this.#faireTourner(p.key));
    await Promise.all(resolus.map((p, i) => new Promise((r) => setTimeout(() => { this.#afficher(p); r(); }, rollDurationMs + i * staggerMs))));
    if (!participants.some((p) => p.pending) && this.payload.winners) this.#conclure();
  }

  /** Affiche le résultat d'un participant sur sa carte (et lance l'effet des 01 / maladresses). */
  #afficher(p) {
    const carte = this.#ligne(p.key);
    if (!carte || p.roll == null) return;
    this.#arreter(p.key);
    this.reveles.set(p.key, p.roll);
    const e = etat(p, this.requis);
    carte.classList.remove("re-b-en-attente", "re-b-ok", "re-b-ko", "re-b-crit", "re-b-fumble");
    carte.classList.add("re-b-revele", `re-b-${e}`);
    carte.style.setProperty("--re-niveau", LEVEL_COLOR[p.level]);
    carte.querySelector(".re-b-zone").innerHTML = `<span class="re-b-valeur">${pad(p.roll)}</span>`;
    carte.querySelector(".re-b-etat").innerHTML = `<i class="${ICONE[e]}"></i> ${L(`Level.${p.level}`)}`;
    if ((p.level === "critical" || p.level === "fumble") && !this.effets.has(p.key)) {
      this.effets.add(p.key);
      effetCritique({
        kind: p.level, actorUuid: p.actorUuid, nom: p.name, img: p.img,
        libelle: this.payload.label, resultat: p.roll, graine: graine(this.payload.id + p.key)
      });
    }
  }

  /** Un joueur (ou le Gardien à sa place) lance depuis la bannière. */
  #lancer(bouton) {
    const p = this.payload.participants.find((x) => x.key === bouton.dataset.key);
    if (!p?.pending) return;
    bouton.disabled = true;
    const bonus = p.dice > 0 ? p.dice : 0;
    const malus = p.dice < 0 ? -p.dice : 0;
    const { roll } = rollPercentile(bonus, malus);
    const level = successLevel(roll, p.effectiveSkill);
    const rank = RANK[level];
    const result = {
      rollId: this.payload.id, key: p.key, roll, level, rank,
      meetsThreshold: this.requis === null ? null : rank >= this.requis
    };
    this.reveler(result);
    broadcast("roll-response", result);
    if (game.user.isGM) handleRollResponse(result);
  }

  /** Résultat d'un joueur reçu : petit défilement puis révélation. */
  reveler(data) {
    const p = this.payload.participants.find((x) => x.key === data.key);
    if (!p || !p.pending) return;
    Object.assign(p, { roll: data.roll, level: data.level, rank: data.rank, meetsThreshold: data.meetsThreshold, pending: false });
    if (this.payload.playSound) jouer(this.payload.soundRoll);
    this.#faireTourner(p.key);
    setTimeout(() => this.#afficher(p), 600);
  }

  /** Tous les jets sont rentrés (message du Gardien) : valeurs définitives et verdict. */
  finaliser(payload) {
    this.payload = payload;
    setTimeout(() => {
      for (const p of payload.participants) if (this.reveles.get(p.key) !== p.roll) this.#afficher(p);
      this.#conclure();
    }, 700);
  }

  #conclure() {
    if (this.fini || !this.el) return;
    this.fini = true;
    const { participants, winners, playSound, soundComplete, soundFumble, autoCloseSeconds } = this.payload;
    for (const k of winners?.winnerKeys ?? []) this.#ligne(k)?.classList.add("re-b-gagnant");
    if (playSound) jouer(participants.some((p) => p.level === "fumble") && soundFumble ? soundFumble : soundComplete);
    const b = bilan(this.payload);
    const v = this.el.querySelector(".re-b-verdict");
    v.textContent = b.verdict;
    v.classList.add("re-b-visible");
    if (autoCloseSeconds > 0) setTimeout(() => this.fermer(), autoCloseSeconds * 1000);
  }

  fermer(immediat = false) {
    const el = this.el;
    if (!el) return;
    this.el = null;
    for (const k of [...this.tourne.keys()]) this.#arreter(k);
    if (courante === this) courante = null;
    if (immediat) return el.remove();
    el.classList.add("re-b-sortie");
    setTimeout(() => el.remove(), 450);
  }
}
