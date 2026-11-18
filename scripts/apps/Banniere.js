/**
 * Bannière de lancer de groupe, affichée chez tout le monde (à la manière d'Epic Rolls) :
 * le dé à lancer, les portraits des participants, et chaque joueur lance depuis son portrait.
 * Ensuite : pousser le jet ou dépenser de la Chance, puis le verdict du groupe.
 * Léger pour le processeur : une seule boucle de défilement (ticker), pas de minuterie par carte.
 */
import { lancerPourcentage, montrerDes, successLevel, RANK, LEVEL_COLOR } from "../lib/coc7.js";
import { broadcast } from "../lib/socket.js";
import { handleRollResponse, handleAjustement, forcerFin } from "../lib/roll-manager.js";
import { effetCritique } from "../lib/effets.js";
import { palierRequis, etat, ICONE, desHTML, bilan, graine, options, mentions, seuilValeur, coutChance } from "../lib/resultat.js";
import { getLuckValue, luckPath } from "../lib/actor-skills.js";
import { tourner, arreter } from "../lib/ticker.js";

const L = (k, d) => (d ? game.i18n.format(`ROLLENSEMBLECOC7.${k}`, d) : game.i18n.localize(`ROLLENSEMBLECOC7.${k}`));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const pad = (n) => String(n).padStart(2, "0");
const jouer = (src) => src && foundry.audio.AudioHelper.play({ src, volume: 0.8, autoplay: true, loop: false }, false);
const NIVEAU = ["fumble", "fail", "regular", "hard", "extreme", "critical"];

/** Un d10 « des pourcentages » dessiné (trapézoèdre vu de face). */
const DE = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <polygon class="re-de-face" points="50,4 94,40 80,92 20,92 6,40"/>
  <polyline class="re-de-arete" points="6,40 50,56 94,40"/><line class="re-de-arete" x1="50" y1="56" x2="50" y2="4"/>
  <line class="re-de-arete" x1="50" y1="56" x2="20" y2="92"/><line class="re-de-arete" x1="50" y1="56" x2="80" y2="92"/>
  <text x="50" y="80" text-anchor="middle">%</text></svg>`;

let courante = null;

function acteurSync(uuid) {
  let a = null;
  try { a = fromUuidSync(uuid); } catch { a = null; }
  return a?.actor ?? a;
}

export class Banniere {
  static ouvrir(payload) {
    courante?.fermer(true);
    courante = new Banniere(payload);
  }

  static appliquer(data) {
    if (courante?.payload.id === data.rollId) courante.reveler(data);
  }

  /** Lancer du Gardien avec Dice So Nice : les dés ont fini de rouler, on révèle. */
  static revelerTout(id) {
    if (courante?.payload.id === id) courante.#revelerTout();
  }

  static rattrapage(id) {
    if (courante?.payload.id === id) courante.#rattrapage();
  }

  static ajuster(data) {
    if (courante?.payload.id === data.id) courante.#ajuster(data);
  }

  static finaliser(payload) {
    if (courante?.payload.id === payload.id) courante.finaliser(payload);
  }

  constructor(payload) {
    this.payload = payload;
    this.requis = palierRequis(payload);
    this.reveles = new Map(); // clé → valeur affichée
    this.effets = new Set(); // clés dont l'effet critique a été joué
    this.fini = false;
    this.phase = "jets";
    this.#construire();
    this.#animer();
  }

  get #masque() {
    return !!this.payload.cache && !game.user.isGM;
  }

  #peutAgir(p) {
    return !!(acteurSync(p.actorUuid)?.isOwner || game.user.isGM);
  }

  /* ---------------------------------------------------------------- */

  #carte(p) {
    const lancer = p.pending && this.#peutAgir(p);
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
      <div class="re-b-mentions"></div>
      <div class="re-b-actions"></div>
    </div>`;
  }

  #carteAdversaire(a) {
    return `<div class="re-b-vs">VS</div>
      <div class="re-b-carte re-b-adversaire" data-key="__adv">
        <div class="re-b-portrait"><img src="${esc(a.img)}" alt=""></div>
        <div class="re-b-nom">${esc(a.name)}</div>
        <div class="re-b-cible">${esc(a.skillLabel)}${a.cache && !game.user.isGM ? "" : ` · ${a.effectiveSkill} %`}${desHTML(a.dice)}</div>
        <div class="re-b-zone"><span class="re-b-valeur">--</span></div>
        <div class="re-b-etat"></div>
      </div>`;
  }

  #construire() {
    const { label, participants, teams, adversaire } = this.payload;
    const competence = participants[0]?.skillLabel ?? "";
    const diff = this.payload.difficulty && this.payload.difficulty !== "none" && !adversaire ? L(`Level.${this.payload.difficulty}`) : "";
    const regle = this.payload.regle && this.payload.regle !== "chacun" && !teams ? L(`Regle.Nom.${this.payload.regle}`) : "";
    const sous = [label !== competence ? competence : "", diff ? `${L("Banniere.Difficulte")} : ${diff}` : "", regle].filter(Boolean).join(" · ");
    const des = participants.map((p) => Number(p.dice) || 0);
    const memeDes = des.every((d) => d === des[0]) ? desHTML(des[0]) : "";

    let cartes;
    if (teams) {
      const groupe = (t) => participants.filter((p) => p.team === t).map((p) => this.#carte(p)).join("");
      cartes = `<div class="re-b-equipe" data-team="A"><div class="re-b-equipe-nom">${L("Config.TeamA")}</div><div class="re-b-rang">${groupe("A")}</div></div>
        <div class="re-b-vs">VS</div>
        <div class="re-b-equipe" data-team="B"><div class="re-b-equipe-nom">${L("Config.TeamB")}</div><div class="re-b-rang">${groupe("B")}</div></div>`;
    } else {
      cartes = `<div class="re-b-rang">${participants.map((p) => this.#carte(p)).join("")}</div>`;
      if (adversaire) cartes += this.#carteAdversaire(adversaire);
    }

    const el = document.createElement("div");
    el.id = "re-banniere";
    el.className = `re-banniere re-t-${this.payload.theme ?? "classique"} ${teams ? "re-b-equipes" : ""} ${adversaire ? "re-b-contre" : ""}`;
    el.innerHTML = `<div class="re-b-bande">
        <button type="button" class="re-b-fermer" title="${L("Spectator.Close")}"><i class="fa-solid fa-xmark"></i></button>
        <div class="re-b-tete">
          <div class="re-b-de">${DE}</div>
          <div class="re-b-titres">
            <div class="re-b-kicker">${L("Banniere.Kicker")}${memeDes}</div>
            <h2>${esc(label)}</h2>
            ${sous ? `<div class="re-b-sous">${esc(sous)}</div>` : ""}
            ${this.payload.cache ? `<div class="re-b-secret"><i class="fa-solid fa-eye-slash"></i> ${L(game.user.isGM ? "Banniere.SecretMJ" : "Banniere.Secret")}</div>` : ""}
          </div>
        </div>
        <div class="re-b-cartes">${cartes}</div>
        <div class="re-b-verdict"></div>
        ${game.user.isGM ? `<button type="button" class="re-b-valider" title="${L("Rattrapage.ValiderAide")}"><i class="fa-solid fa-flag-checkered"></i> ${L("Rattrapage.Valider")}</button>` : ""}
      </div>`;
    el.querySelector(".re-b-fermer").addEventListener("click", () => this.fermer());
    el.querySelector(".re-b-valider")?.addEventListener("click", () => forcerFin(this.payload.id));
    // Un seul écouteur pour tous les boutons des cartes
    el.querySelector(".re-b-cartes").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-key]");
      if (!b || b.disabled) return;
      const p = this.payload.participants.find((x) => x.key === b.dataset.key);
      if (!p) return;
      if (b.classList.contains("re-b-lancer")) this.#lancer(b, p);
      else if (b.dataset.act === "pousser") this.#pousser(b, p);
      else if (b.dataset.act === "chance") this.#chance(b, p, Number(b.dataset.cout));
      else if (b.dataset.act === "accepter") this.#envoyerAjustement(p, {});
    });
    document.body.append(el);
    this.el = el;
    requestAnimationFrame(() => el.classList.add("re-b-visible"));
  }

  #ligne(key) {
    return this.el?.querySelector(`.re-b-carte[data-key="${key}"]`);
  }

  #faireTourner(key) {
    const z = this.#ligne(key)?.querySelector(".re-b-zone");
    if (!z) return;
    z.innerHTML = `<span class="re-b-valeur re-b-tourne">--</span>`;
    tourner(z.firstElementChild);
  }

  async #animer() {
    const { participants, rollDurationMs, staggerMs, playSound, soundRoll, adversaire } = this.payload;
    const resolus = participants.filter((p) => !p.pending);
    if (playSound && (resolus.length || adversaire)) jouer(soundRoll);
    resolus.forEach((p) => this.#faireTourner(p.key));
    if (adversaire) this.#faireTourner("__adv");
    if (this.payload.attente3d) return; // la révélation attend la fin des dés 3D
    if (adversaire) setTimeout(() => this.#afficherAdversaire(), rollDurationMs);
    await Promise.all(resolus.map((p, i) => new Promise((r) => setTimeout(() => { this.#afficher(p); r(); }, rollDurationMs + (i + (adversaire ? 1 : 0)) * staggerMs))));
  }

  async #revelerTout() {
    const { participants, staggerMs, adversaire } = this.payload;
    if (adversaire) this.#afficherAdversaire();
    const resolus = participants.filter((p) => !p.pending);
    await Promise.all(resolus.map((p, i) => new Promise((r) => setTimeout(() => { this.#afficher(p); r(); }, 200 + (i + (adversaire ? 1 : 0)) * staggerMs))));
  }

  #afficherAdversaire() {
    const a = this.payload.adversaire;
    const carte = this.#ligne("__adv");
    if (!a || !carte) return;
    arreter(carte.querySelector(".re-b-tourne"));
    const cache = (a.cache || this.payload.cache) && !game.user.isGM;
    carte.classList.add("re-b-revele");
    carte.querySelector(".re-b-zone").innerHTML = `<span class="re-b-valeur">${cache ? "?" : pad(a.roll)}</span>`;
    carte.querySelector(".re-b-etat").innerHTML = cache ? `<i class="fa-solid fa-eye-slash"></i> ${L("Adversaire.Cache")}` : L(`Level.${a.level}`);
  }

  /** Affiche le résultat d'un participant sur sa carte (et lance l'effet des 01 / maladresses). */
  #afficher(p) {
    const carte = this.#ligne(p.key);
    if (!carte || p.roll == null) return;
    arreter(carte.querySelector(".re-b-tourne"));
    this.reveles.set(p.key, `${p.roll}|${p.level}|${p.luckSpent ?? ""}|${p.perte ?? ""}|${p.xp ?? ""}`);
    if (this.#masque) {
      carte.classList.remove("re-b-en-attente");
      carte.classList.add("re-b-revele", "re-b-cache");
      carte.querySelector(".re-b-zone").innerHTML = `<span class="re-b-valeur"><i class="fa-solid fa-eye-slash"></i></span>`;
      carte.querySelector(".re-b-etat").textContent = L("Banniere.JetFait");
      return;
    }
    const e = etat(p, this.payload);
    carte.classList.remove("re-b-en-attente", "re-b-ok", "re-b-ko", "re-b-crit", "re-b-fumble");
    carte.classList.add("re-b-revele", `re-b-${e}`);
    carte.style.setProperty("--re-niveau", LEVEL_COLOR[p.level]);
    carte.querySelector(".re-b-zone").innerHTML = `<span class="re-b-valeur">${pad(p.roll)}</span>`;
    carte.querySelector(".re-b-etat").innerHTML = `<i class="${ICONE[e]}"></i> ${L(`Level.${p.level}`)}`;
    carte.querySelector(".re-b-mentions").innerHTML = mentions(p, this.payload)
      .map((m) => `<span class="re-m ${m.cls}"><i class="${m.icone}"></i> ${esc(m.texte)}</span>`).join("");
    if ((p.level === "critical" || p.level === "fumble") && !this.effets.has(p.key)) {
      this.effets.add(p.key);
      effetCritique({
        kind: p.level, actorUuid: p.actorUuid, nom: p.name, img: p.img,
        libelle: this.payload.label, resultat: p.roll, graine: graine(this.payload.id + p.key + p.roll)
      });
    }
  }

  /** Lance un d100 pour ce participant, avec ses dés bonus/malus, et montre les dés 3D. */
  async #jet(p) {
    const bonus = p.dice > 0 ? p.dice : 0;
    const malus = p.dice < 0 ? -p.dice : 0;
    const { roll, jet } = await lancerPourcentage(bonus, malus);
    this.#faireTourner(p.key);
    await montrerDes([jet], this.payload.cache);
    const level = successLevel(roll, p.effectiveSkill);
    const rank = RANK[level];
    return { roll, level, rank, meetsThreshold: this.requis === null ? null : rank >= this.requis };
  }

  /** Un joueur (ou le Gardien à sa place) lance depuis la bannière. */
  async #lancer(bouton, p) {
    if (!p.pending) return;
    bouton.disabled = true;
    const r = await this.#jet(p);
    const result = { rollId: this.payload.id, key: p.key, ...r };
    this.reveler(result);
    broadcast("roll-response", result);
    if (game.user.isGM) handleRollResponse(result);
  }

  /** Résultat d'un joueur reçu : petit défilement puis révélation. */
  reveler(data) {
    const p = this.payload.participants.find((x) => x.key === data.key);
    if (!p || !p.pending) return;
    Object.assign(p, { roll: data.roll, level: data.level, rank: data.rank, rangJet: data.rank, meetsThreshold: data.meetsThreshold, pending: false });
    if (this.payload.playSound) jouer(this.payload.soundRoll);
    this.#faireTourner(p.key);
    setTimeout(() => this.#afficher(p), 600);
  }

  /* ---------- Rattrapage : pousser le jet ou dépenser de la Chance ---------- */

  #rattrapage() {
    if (this.fini || !this.el) return;
    this.phase = "rattrapage";
    this.el.classList.add("re-b-phase-rattrapage");
    const v = this.el.querySelector(".re-b-verdict");
    v.textContent = L("Rattrapage.Titre");
    v.classList.add("re-b-visible", "re-b-verdict-info");
    for (const p of this.payload.participants) this.#boutons(p);
  }

  #boutons(p) {
    const zone = this.#ligne(p.key)?.querySelector(".re-b-actions");
    if (!zone) return;
    const peut = this.#peutAgir(p);
    const dispo = getLuckValue(acteurSync(p.actorUuid));
    const o = options(p, this.payload, dispo);
    if (this.phase !== "rattrapage" || this.fini || (!o.pousser && !o.chance)) { zone.innerHTML = ""; return; }
    if (!peut) { zone.innerHTML = `<span class="re-b-reflechit"><i class="fa-solid fa-hourglass-half"></i> ${L("Rattrapage.Reflechit")}</span>`; return; }
    // Compteur de Chance : ce qu'il a, ce qu'il faut, ce qui restera
    const cout = coutChance(p, this.payload);
    let compteur = "";
    if (cout != null && dispo != null) {
      compteur = cout <= dispo
        ? `<div class="re-b-chance-info"><i class="fa-solid fa-clover"></i> ${L("Rattrapage.ChanceCompte", { dispo, cout, reste: dispo - cout })}</div>`
        : `<div class="re-b-chance-info re-b-chance-manque"><i class="fa-solid fa-clover"></i> ${L("Rattrapage.ChanceManque", { dispo, cout })}</div>`;
    }
    zone.innerHTML = compteur + [
      o.pousser ? `<button type="button" data-key="${p.key}" data-act="pousser" title="${L("Rattrapage.PousserAide")}"><i class="fa-solid fa-hand-fist"></i> ${L("Rattrapage.Pousser")}</button>` : "",
      o.chance ? `<button type="button" data-key="${p.key}" data-act="chance" data-cout="${o.chance}" title="${L("Rattrapage.ChanceAide")}"><i class="fa-solid fa-clover"></i> ${L("Rattrapage.Chance", { n: o.chance })}</button>` : "",
      `<button type="button" data-key="${p.key}" data-act="accepter" title="${L("Rattrapage.AccepterAide")}"><i class="fa-solid fa-check"></i></button>`
    ].join("");
  }

  async #pousser(bouton, p) {
    this.#ligne(p.key)?.querySelectorAll(".re-b-actions button").forEach((b) => { b.disabled = true; });
    const r = await this.#jet(p);
    this.#envoyerAjustement(p, { ...r, rangJet: r.rank, pushed: true });
  }

  async #chance(bouton, p, cout) {
    const a = acteurSync(p.actorUuid);
    const dispo = getLuckValue(a);
    if (!a || dispo == null || cout > dispo) return;
    this.#ligne(p.key)?.querySelectorAll(".re-b-actions button").forEach((b) => { b.disabled = true; });
    await a.update({ [luckPath(a)]: dispo - cout });
    const rang = this.requis ?? RANK.regular;
    this.#envoyerAjustement(p, { luckSpent: cout, luckRestant: dispo - cout, rangJet: p.rangJet ?? p.rank, rank: rang, level: NIVEAU[rang], meetsThreshold: this.requis === null ? null : true });
  }

  #envoyerAjustement(p, changes) {
    const data = { id: this.payload.id, key: p.key, changes };
    this.#ajuster(data);
    broadcast("ajustement", data);
    if (game.user.isGM) handleAjustement(data);
  }

  #ajuster(data) {
    const p = this.payload.participants.find((x) => x.key === data.key);
    if (!p) return;
    Object.assign(p, data.changes, { resolu: true });
    this.#boutons(p);
    if (data.changes.pushed) {
      if (this.payload.playSound) jouer(this.payload.soundRoll);
      this.#faireTourner(p.key);
      setTimeout(() => this.#afficher(p), 600);
    } else this.#afficher(p);
  }

  /* ---------- Fin ---------- */

  /** Le Gardien a tout validé : valeurs définitives, pertes de SAN, expérience, verdict. */
  finaliser(payload) {
    this.payload = payload;
    this.fini = true;
    setTimeout(() => {
      if (!this.el) return;
      this.el.classList.remove("re-b-phase-rattrapage");
      this.el.querySelector(".re-b-valider")?.remove();
      if (payload.adversaire) this.#afficherAdversaire();
      for (const p of payload.participants) {
        this.#boutons(p);
        const cle = `${p.roll}|${p.level}|${p.luckSpent ?? ""}|${p.perte ?? ""}|${p.xp ?? ""}`;
        if (!p.pending && this.reveles.get(p.key) !== cle) this.#afficher(p);
      }
      this.#conclure();
    }, 700);
  }

  #conclure() {
    if (!this.el) return;
    const { participants, winners, playSound, soundComplete, soundFumble, autoCloseSeconds } = this.payload;
    if (!this.#masque) for (const k of winners?.winnerKeys ?? []) this.#ligne(k)?.classList.add("re-b-gagnant");
    if (playSound) jouer(participants.some((p) => p.level === "fumble") && soundFumble && !this.#masque ? soundFumble : soundComplete);
    const b = bilan(this.payload);
    const v = this.el.querySelector(".re-b-verdict");
    v.classList.remove("re-b-verdict-info", "re-b-groupe-ok", "re-b-groupe-ko");
    v.textContent = this.#masque ? L("Bilan.Cache") : b.verdict;
    if (!this.#masque && b.groupe !== null) v.classList.add(b.groupe ? "re-b-groupe-ok" : "re-b-groupe-ko");
    v.classList.add("re-b-visible");
    if (autoCloseSeconds > 0) setTimeout(() => this.fermer(), autoCloseSeconds * 1000);
  }

  fermer(immediat = false) {
    const el = this.el;
    if (!el) return;
    this.el = null;
    el.querySelectorAll(".re-b-tourne").forEach((s) => arreter(s));
    if (courante === this) courante = null;
    if (immediat) return el.remove();
    el.classList.add("re-b-sortie");
    setTimeout(() => el.remove(), 450);
  }
}

export { seuilValeur };
