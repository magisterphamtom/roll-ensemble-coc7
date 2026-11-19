import { MODULE_ID } from "../settings.js";
import { broadcast } from "../lib/socket.js";
import { lancerPourcentage, montrerDes, dsnActif, successLevel, determineWinners, makeRollId, RANK } from "../lib/coc7.js";
import { broadcast as diffuser } from "../lib/socket.js";
import { Banniere } from "./Banniere.js";
import {
  getActorSkills, getSkillValueByLabel, CHARACTERISTICS, getCharacteristicValue,
  SPECIAL_ATTRIBUTES, getSpecialAttributeValue, getActiveOwners
} from "../lib/actor-skills.js";
import { creerMacroFavori } from "../lib/favoris.js";
import { registerRoll, apresJets } from "../lib/roll-manager.js";
import { ouvrirAffichage, enBanniere } from "../lib/affichage.js";
import { themeActif, THEMES } from "../lib/themes.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RollConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "roll-ensemble-coc7-config",
    tag: "form",
    window: {
      title: "ROLLENSEMBLECOC7.Config.Title",
      icon: "fa-solid fa-dice-d10",
      resizable: true
    },
    position: { width: 1060, height: 720 },
    form: {
      handler: RollConfigApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false
    },
    actions: {
      toggleToken: RollConfigApp.#onToggleToken,
      selectSkill: RollConfigApp.#onSelectSkill,
      toggleForceGM: RollConfigApp.#onToggleForceGM,
      launch: RollConfigApp.#onLaunch,
      sendRequest: RollConfigApp.#onSendRequest,
      setDifficulty: function (e, t) { this.#sync(); this.difficulty = t.dataset.value; this.render(); },
      setGlobalDice: function (e, t) { this.#sync(); this.globalDice = Number(t.dataset.value); for (const p of this.participants) p.dice = this.globalDice; this.render(); },
      setDice: function (e, t) { this.#sync(); const p = this.participants.find(x => x.key === t.dataset.key); if (p) p.dice = Number(t.dataset.value); this.render(); },
      setTeam: function (e, t) { this.#sync(); const p = this.participants.find(x => x.key === t.dataset.key); if (p) p.team = p.team === "A" ? "B" : "A"; this.render(); },
      toggleTeams: function () { this.#sync(); this.teams = !this.teams; if (this.teams) this.adversaire.on = false; this.render(); },
      toggleCache: function () { this.#sync(); this.cache = !this.cache; this.render(); },
      toggleNpc: function () { this.#sync(); this.npcOpen = !this.npcOpen; this.render(); },
      addAllPlayers: RollConfigApp.#onAddAllPlayers,
      saveMacro: RollConfigApp.#onSaveMacro,
      setRegle: function (e, t) { this.#sync(); this.regle = t.dataset.value; this.render(); },
      toggleAdversaire: function () { this.#sync(); this.adversaire.on = !this.adversaire.on; if (this.adversaire.on) this.teams = false; this.render(); },
      setAdvDice: function (e, t) { this.#sync(); this.adversaire.dice = Number(t.dataset.value); this.render(); },
      toggleAdvCache: function () { this.#sync(); this.adversaire.cache = !this.adversaire.cache; this.render(); },
      clearAll: function () { this.participants = []; this.tousJoueurs = false; this.render(); }
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/roll-config.hbs` }
  };

  /** @type {Array<{key,name,img,actorUuid,modifier,dice,team,forceGM}>} */
  participants = [];
  teams = false;
  label = "";
  difficulty = "none"; // "none" | "regular" | "hard" | "extreme"
  globalDice = 0; // dés bonus/malus appliqués à tous
  npcOpen = false;
  cache = false; // résultats cachés aux joueurs
  regle = "chacun"; // chacun | un | tous | majorite
  /** Thème choisi à la volée dans la fenêtre (null = réglage du module, « auto » = suit l'époque) */
  themeChoix = RollConfigApp.dernierTheme ?? null;
  perteSan = { ok: "0", ko: "1D6" };
  tousJoueurs = false;
  /** Jet d'opposition contre un adversaire lancé par le Gardien */
  adversaire = { on: false, actorUuid: null, skill: null, dice: 0, cache: false };
  search = "";
  /** @type {{kind: "skill"|"char"|"special", label: string, key?: string}|null} */
  selectedSkill = null;

  async _prepareContext() {
    const L = (k) => game.i18n.localize(`ROLLENSEMBLECOC7.${k}`);
    const resolvedActors = await Promise.all(this.participants.map(p => (p.actorUuid ? fromUuid(p.actorUuid) : null)));
    const choisi = (uuid) => this.participants.some(p => p.actorUuid === uuid);

    // --- Personnages joueurs : personnages attribués aux joueurs + jetons joueurs de la scène
    const placeables = (canvas.tokens?.placeables ?? []).filter(t => t.actor);
    const joueurs = new Map();
    for (const u of game.users.filter(u => !u.isGM && u.character)) {
      const a = u.character;
      joueurs.set(a.uuid, { actorUuid: a.uuid, name: a.name, img: a.img, actor: a });
    }
    for (const t of placeables.filter(t => t.actor.hasPlayerOwner)) {
      if (!joueurs.has(t.actor.uuid)) joueurs.set(t.actor.uuid, { actorUuid: t.actor.uuid, name: t.name || t.actor.name, img: t.actor.img || t.document.texture?.src, actor: t.actor });
    }
    const players = [...joueurs.values()]
      .map(j => ({ ...j, actor: undefined, selected: choisi(j.actorUuid), online: getActiveOwners(j.actor).length > 0, score: this.#scoreDe(j.actor) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // --- PNJ et autres jetons de la scène
    const npcs = placeables
      .filter(t => !joueurs.has(t.actor.uuid))
      .map(t => ({ actorUuid: t.actor.uuid, name: t.name || t.actor.name, img: t.document.texture?.src || t.actor.img, selected: choisi(t.actor.uuid) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // --- Compétences des participants sélectionnés (combien l'ont)
    const compte = new Map();
    resolvedActors.forEach(actor => getActorSkills(actor).forEach(sk => compte.set(sk.label, (compte.get(sk.label) ?? 0) + 1)));
    const n = this.participants.length;
    const estChoisie = (kind, val) => this.selectedSkill?.kind === kind && (kind === "skill" ? this.selectedSkill.label === val : this.selectedSkill.key === val);
    const skills = [...compte.entries()].map(([label, c]) => ({ label, count: c, all: c === n, selected: estChoisie("skill", label), search: label.toLowerCase() }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const COURANTES = ["trouver objet caché", "écouter", "discrétion", "bibliothèque", "psychologie", "esquive", "persuasion", "baratin", "premiers soins", "grimper", "sauter", "nager", "spot hidden", "listen", "stealth", "library use", "dodge"];
    const quick = COURANTES.map(c => skills.find(s => s.search === c)).filter(Boolean);
    const specials = SPECIAL_ATTRIBUTES.map(c => ({ ...c, selected: estChoisie("special", c.key) }));
    const chars = CHARACTERISTICS.map(c => ({ ...c, selected: estChoisie("char", c.key) }));

    // --- Participants sélectionnés, avec leur score pour le jet choisi
    const selected = this.participants.map((p, i) => {
      const actor = resolvedActors[i];
      const owners = actor ? getActiveOwners(actor) : [];
      const score = this.#scoreDe(actor);
      return {
        ...p,
        img: actor?.img ?? p.img,
        score,
        effectif: score === null ? null : Math.max(0, Math.min(100, score + (p.modifier || 0))),
        crans: [-2, -1, 0, 1, 2].map(v => ({ v, actif: p.dice === v, cls: v < 0 ? "malus" : v > 0 ? "bonus" : "normal", n: Math.abs(v) })),
        canRequest: owners.length > 0,
        willRequest: owners.length > 0 && !p.forceGM,
        ownerNames: owners.map(u => u.name).join(", ")
      };
    });

    // --- Adversaire : jetons de la scène (hors participants) et ses compétences
    const advActeurs = placeables.filter(t => !choisi(t.actor.uuid)).map(t => ({ uuid: t.actor.uuid, name: t.name || t.actor.name, selected: t.actor.uuid === this.adversaire.actorUuid }));
    if (this.adversaire.actorUuid && !advActeurs.some(a => a.selected)) {
      const a0 = await fromUuid(this.adversaire.actorUuid);
      if (a0) advActeurs.unshift({ uuid: a0.uuid, name: a0.name, selected: true });
    }
    const advActor = this.adversaire.actorUuid ? await fromUuid(this.adversaire.actorUuid) : null;
    const sk = this.adversaire.skill;
    const val = (kind, v) => `${kind}|${v}`;
    const advSkills = advActor ? [
      ...getActorSkills(advActor).map(x => ({ v: val("skill", x.label), label: `${x.label} (${x.value} %)`, selected: sk?.kind === "skill" && sk.label === x.label })),
      ...SPECIAL_ATTRIBUTES.map(c => ({ v: val("special", c.key), label: c.label, selected: sk?.kind === "special" && sk.key === c.key })),
      ...CHARACTERISTICS.map(c => ({ v: val("char", c.key), label: `${c.label} (×5)`, selected: sk?.kind === "char" && sk.key === c.key }))
    ] : [];

    const reglage = (() => { try { return game.settings.get(MODULE_ID, "theme"); } catch { return "auto"; } })();
    const courant = this.themeChoix ?? reglage;
    return {
      themes: ["auto", ...THEMES].map(v => ({ v, label: L(`Theme.${v}`), selected: courant === v })),
      theme: themeActif(this.themeChoix),
      regles: ["chacun", "un", "tous", "majorite"].map(v => ({ v, actif: this.regle === v, label: L(`Regle.Nom.${v}`) })),
      adversaire: { ...this.adversaire, acteurs: advActeurs, skills: advSkills, actorName: advActor?.name,
        crans: [-2, -1, 0, 1, 2].map(v => ({ v, actif: this.adversaire.dice === v, cls: v < 0 ? "malus" : v > 0 ? "bonus" : "normal", n: Math.abs(v) })) },
      estSan: this.selectedSkill?.kind === "special" && this.selectedSkill.key === "san",
      perteSan: this.perteSan,
      label: this.label,
      teams: this.teams,
      cache: this.cache,
      npcOpen: this.npcOpen,
      players, npcs, selected,
      skills, quick, specials, chars,
      hasParticipants: n > 0,
      selectedSkillLabel: this.#skillDisplayLabel(),
      difficulties: ["none", "regular", "hard", "extreme"].map(v => ({ v, actif: this.difficulty === v, label: v === "none" ? L("Config.DiffAucune") : L(`Level.${v}`) })),
      globalCrans: [-2, -1, 0, 1, 2].map(v => ({ v, actif: this.globalDice === v, cls: v < 0 ? "malus" : v > 0 ? "bonus" : "normal", n: Math.abs(v),
        label: v === 0 ? L("Config.Dice.Normal") : L(`Config.Dice.${v > 0 ? "P" : "M"}${Math.abs(v)}`) })),
      nbRequetes: selected.filter(p => p.willRequest).length
    };
  }

  /** Score de base d'un acteur pour le jet choisi (null s'il n'a pas la compétence). */
  #scoreDe(actor) {
    if (!actor || !this.selectedSkill) return null;
    if (this.selectedSkill.kind === "char") return getCharacteristicValue(actor, this.selectedSkill.key) * 5;
    if (this.selectedSkill.kind === "special") return getSpecialAttributeValue(actor, this.selectedSkill.key);
    return getSkillValueByLabel(actor, this.selectedSkill.label);
  }

  /** Relit les champs saisis (nom du lancer, modificateurs) avant de redessiner. */
  #sync() {
    const el = this.element;
    if (!el) return;
    const label = el.querySelector('[name="label"]');
    if (label) this.label = label.value;
    const th = el.querySelector('[name="themeChoix"]');
    if (th) this.themeChoix = th.value || null;
    for (const p of this.participants) {
      const m = el.querySelector(`[name="modifier-${p.key}"]`);
      if (m) p.modifier = Number(m.value) || 0;
    }
    const ok = el.querySelector('[name="perteOk"]'), ko = el.querySelector('[name="perteKo"]');
    if (ok) this.perteSan.ok = ok.value.trim() || "0";
    if (ko) this.perteSan.ko = ko.value.trim() || "0";
    const advA = el.querySelector('[name="advActor"]');
    if (advA && advA.value !== (this.adversaire.actorUuid ?? "")) { this.adversaire.actorUuid = advA.value || null; this.adversaire.skill = null; }
    const advS = el.querySelector('[name="advSkill"]');
    if (advS && advS.value) {
      const [kind, ...rest] = advS.value.split("|");
      const v = rest.join("|");
      this.adversaire.skill = kind === "skill" ? { kind, label: v } : { kind, key: v };
    }
  }

  #skillDisplayLabel() {
    if (!this.selectedSkill) return null;
    if (this.selectedSkill.kind === "char") {
      const c = CHARACTERISTICS.find(c => c.key === this.selectedSkill.key);
      return `${c?.label ?? this.selectedSkill.key} (×5)`;
    }
    if (this.selectedSkill.kind === "special") {
      const c = SPECIAL_ATTRIBUTES.find(c => c.key === this.selectedSkill.key);
      return c?.label ?? this.selectedSkill.key;
    }
    return this.selectedSkill.label;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Raccourci : cliquer un token JOUEUR sur le canvas l'ajoute directement
    // aux participants tant que cette fenêtre est ouverte.
    this._controlTokenHookId = Hooks.on("controlToken", (token, controlled) => {
      if (!controlled) return;
      const actor = token?.actor;
      if (!actor?.hasPlayerOwner) return;
      if (this.participants.some(p => p.actorUuid === actor.uuid)) return;
      this.#addActor(actor);
      this.render();
    });
  }

  _onClose(options) {
    super._onClose?.(options);
    if (this._controlTokenHookId) Hooks.off("controlToken", this._controlTokenHookId);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Glisser un acteur ou un jeton n'importe où sur la fenêtre l'ajoute
    if (!this._depotPret) {
      this._depotPret = true;
      this.element.addEventListener("dragover", (ev) => ev.preventDefault());
      this.element.addEventListener("drop", this._onDrop.bind(this));
    }

    // Habillage : thème d'époque de la bannière
    const theme = context.theme ?? "classique";
    this.element.classList.remove(...[...this.element.classList].filter(c => c.startsWith("re-t-")));
    this.element.classList.add("re-cfg", `re-t-${theme}`);

    // Thème choisi à la volée : la fenêtre change tout de suite (et le choix est gardé jusqu'au rechargement)
    this.element.querySelector('[name="themeChoix"]')?.addEventListener("change", (ev) => {
      this.#sync();
      RollConfigApp.dernierTheme = this.themeChoix;
      this.render();
    });

    // Choix de l'adversaire : recharge la liste de ses compétences
    this.element.querySelector('[name="advActor"]')?.addEventListener("change", () => { this.#sync(); this.render(); });

    // Recherche en direct (compétences et PNJ), sans redessiner
    const filtre = (input, selecteur) => {
      if (!input) return;
      const appliquer = () => {
        const q = input.value.trim().toLowerCase();
        this.element.querySelectorAll(selecteur).forEach(el => { el.hidden = !!q && !(el.dataset.search ?? "").includes(q); });
      };
      input.addEventListener("input", appliquer);
      appliquer();
    };
    const rs = this.element.querySelector(".rc-recherche-comp");
    if (rs) { rs.value = this.searchSkill ?? ""; rs.addEventListener("input", () => { this.searchSkill = rs.value; }); }
    filtre(rs, ".rc-comp-liste .rc-comp");
    const rp = this.element.querySelector(".rc-recherche-pnj");
    if (rp) { rp.value = this.search ?? ""; rp.addEventListener("input", () => { this.search = rp.value; }); }
    filtre(rp, ".rc-pnj-liste .rc-pnj");
  }

  async _onDrop(event) {
    event.preventDefault();
    let data;
    try {
      const TE = foundry.applications.ux?.TextEditor?.implementation ?? TextEditor;
      data = TE.getDragEventData(event);
    } catch (err) {
      return;
    }
    if (!data?.type) return;

    let actor = null;
    if (data.type === "Actor") actor = await fromUuid(data.uuid);
    else if (data.type === "Token") {
      const token = await fromUuid(data.uuid);
      actor = token?.actor ?? token?.document?.actor;
    }
    if (!actor) return;
    this.#sync();
    this.#addActor(actor);
    this.npcOpen ||= !actor.hasPlayerOwner;
    this.render();
  }

  #addActor(actor) {
    if (this.participants.some(p => p.actorUuid === actor.uuid)) return;
    this.participants.push({
      key: foundry.utils.randomID(8),
      name: actor.name,
      img: actor.img,
      actorUuid: actor.uuid,
      modifier: 0,
      dice: this.globalDice,
      team: "A",
      forceGM: false
    });
  }

  #removeActor(actorUuid) {
    this.participants = this.participants.filter(p => p.actorUuid !== actorUuid);
  }

  static #onToggleToken(event, target) {
    this.#sync();
    const actorUuid = target.closest("[data-actor-uuid]")?.dataset.actorUuid;
    if (!actorUuid) return;
    (async () => {
      const alreadyIn = this.participants.some(p => p.actorUuid === actorUuid);
      if (alreadyIn) {
        this.#removeActor(actorUuid);
      } else {
        const actor = await fromUuid(actorUuid);
        if (actor) this.#addActor(actor);
      }
      this.render();
    })();
  }

  static async #onAddAllPlayers() {
    this.#sync();
    this.tousJoueurs = true;
    const ctx = await this._prepareContext();
    for (const j of ctx.players) {
      if (this.participants.some(p => p.actorUuid === j.actorUuid)) continue;
      const actor = await fromUuid(j.actorUuid);
      if (actor) this.#addActor(actor);
    }
    this.render();
  }

  static #onSelectSkill(event, target) {
    this.#sync();
    const kind = target.dataset.skillKind;
    if (kind === "char") {
      this.selectedSkill = { kind: "char", key: target.dataset.skillKey };
    } else if (kind === "special") {
      this.selectedSkill = { kind: "special", key: target.dataset.skillKey };
    } else {
      this.selectedSkill = { kind: "skill", label: target.dataset.skillLabel };
    }
    this.render();
  }

  static #onToggleForceGM(event, target) {
    this.#sync();
    const key = target.closest("[data-key]")?.dataset.key;
    const p = this.participants.find(p => p.key === key);
    if (p) p.forceGM = !p.forceGM;
    this.render();
  }

  static async #onSubmit(event, form, formData) {
    this.#sync();
  }


  /** Résout la base + valeur effective de la compétence/caractéristique choisie pour un participant. */
  async #resolveEffectiveSkill(p, actor) {
    let baseSkill = null;
    if (this.selectedSkill.kind === "char") {
      baseSkill = getCharacteristicValue(actor, this.selectedSkill.key) * 5;
    } else if (this.selectedSkill.kind === "special") {
      baseSkill = getSpecialAttributeValue(actor, this.selectedSkill.key);
    } else {
      baseSkill = getSkillValueByLabel(actor, this.selectedSkill.label);
    }
    const noSkill = baseSkill === null;
    const effectiveSkill = Math.max(0, Math.min(100, (baseSkill ?? 0) + (p.modifier || 0)));
    return { noSkill, effectiveSkill };
  }

  #buildBasePayload(rollId, skillDisplayLabel) {
    const sk = this.selectedSkill ?? {};
    return {
      id: rollId,
      label: this.label || skillDisplayLabel || game.i18n.localize("ROLLENSEMBLECOC7.ChatButton"),
      teams: this.teams,
      difficulty: this.adversaire.on ? "none" : this.difficulty,
      cache: this.cache,
      regle: this.teams ? "chacun" : this.regle,
      skillKind: sk.kind, skillKey: sk.key, skillLabel: sk.label ?? null,
      rattrapage: game.settings.get(MODULE_ID, "rattrapage") && enBanniere(),
      experience: game.settings.get(MODULE_ID, "experience"),
      perteSan: sk.kind === "special" && sk.key === "san" ? { ...this.perteSan } : null,
      theme: themeActif(this.themeChoix),
      rollDurationMs: game.settings.get(MODULE_ID, "rollDurationMs"),
      staggerMs: game.settings.get(MODULE_ID, "staggerMs"),
      autoCloseSeconds: game.settings.get(MODULE_ID, "autoCloseSeconds"),
      playSound: game.settings.get(MODULE_ID, "playSound"),
      soundRoll: game.settings.get(MODULE_ID, "soundRoll"),
      soundComplete: game.settings.get(MODULE_ID, "soundComplete"),
      soundFumble: game.settings.get(MODULE_ID, "soundFumble")
    };
  }

  /** Le Gardien lance pour un participant (ou un adversaire) : résultat complet + le jet pour Dice So Nice. */
  async #jetGardien(effectiveSkill, dice, requiredRank) {
    const { roll, jet } = await lancerPourcentage(dice > 0 ? dice : 0, dice < 0 ? -dice : 0);
    const level = successLevel(roll, effectiveSkill);
    const rank = RANK[level];
    return { jet, res: { roll, level, rank, rangJet: rank, meetsThreshold: requiredRank === null ? null : rank >= requiredRank } };
  }

  /** L'adversaire du groupe (jet d'opposition), lancé par le Gardien. */
  async #lancerAdversaire() {
    const a = this.adversaire;
    if (!a.on || !a.actorUuid || !a.skill) return { adversaire: null, jet: null };
    const actor = await fromUuid(a.actorUuid);
    if (!actor) return { adversaire: null, jet: null };
    const base = this.#scoreSkill(actor, a.skill) ?? 0;
    const effectiveSkill = Math.max(0, Math.min(100, base));
    const { jet, res } = await this.#jetGardien(effectiveSkill, a.dice, null);
    return {
      jet,
      adversaire: { name: actor.name, img: actor.img, actorUuid: actor.uuid, skillLabel: this.#libelleSkill(a.skill), effectiveSkill, dice: a.dice, cache: a.cache, ...res }
    };
  }

  #scoreSkill(actor, sk) {
    if (!actor || !sk) return null;
    if (sk.kind === "char") return getCharacteristicValue(actor, sk.key) * 5;
    if (sk.kind === "special") return getSpecialAttributeValue(actor, sk.key);
    return getSkillValueByLabel(actor, sk.label);
  }

  #libelleSkill(sk) {
    if (!sk) return "";
    if (sk.kind === "char") return `${CHARACTERISTICS.find(c => c.key === sk.key)?.label ?? sk.key} (×5)`;
    if (sk.kind === "special") return SPECIAL_ATTRIBUTES.find(c => c.key === sk.key)?.label ?? sk.key;
    return sk.label;
  }

  /** Lancer prêt à partir sans ouvrir la fenêtre (macro favorite) : demande aux joueurs, sinon le Gardien lance. */
  async executer(mode = "auto") {
    if (mode === "launch") return RollConfigApp.#onLaunch.call(this);
    if (mode === "request") return RollConfigApp.#onSendRequest.call(this);
    const joueurs = [];
    for (const p of this.participants) {
      const a = p.actorUuid ? await fromUuid(p.actorUuid) : null;
      if (!p.forceGM && a && getActiveOwners(a).length) joueurs.push(p);
    }
    return joueurs.length ? RollConfigApp.#onSendRequest.call(this) : RollConfigApp.#onLaunch.call(this);
  }

  /** État de la fenêtre sous forme simple, pour une macro favorite. */
  versFavori() {
    this.#sync();
    return {
      label: this.label, skill: this.selectedSkill, difficulty: this.difficulty, globalDice: this.globalDice,
      teams: this.teams, cache: this.cache, regle: this.regle, perteSan: this.perteSan, themeChoix: this.themeChoix,
      adversaire: this.adversaire.on ? { ...this.adversaire } : null,
      tousJoueurs: this.tousJoueurs,
      participants: this.participants.map(p => ({ actorUuid: p.actorUuid, modifier: p.modifier, dice: p.dice, team: p.team, forceGM: p.forceGM }))
    };
  }

  /** Remplit la fenêtre depuis une macro favorite. */
  async depuisFavori(f) {
    Object.assign(this, {
      label: f.label ?? "", selectedSkill: f.skill ?? null, difficulty: f.difficulty ?? "none", globalDice: f.globalDice ?? 0,
      teams: !!f.teams, cache: !!f.cache, regle: f.regle ?? "chacun", perteSan: f.perteSan ?? this.perteSan,
      tousJoueurs: !!f.tousJoueurs, themeChoix: f.themeChoix ?? this.themeChoix
    });
    if (f.adversaire) this.adversaire = { ...this.adversaire, ...f.adversaire, on: true };
    this.participants = [];
    const liste = [...(f.participants ?? [])];
    if (f.tousJoueurs) {
      for (const u of game.users.filter(u => !u.isGM && u.character)) {
        if (!liste.some(x => x.actorUuid === u.character.uuid)) liste.push({ actorUuid: u.character.uuid, dice: f.globalDice ?? 0 });
      }
    }
    for (const x of liste) {
      const a = await fromUuid(x.actorUuid);
      if (!a) continue;
      this.#addActor(a);
      Object.assign(this.participants.at(-1), { modifier: x.modifier ?? 0, dice: x.dice ?? this.globalDice, team: x.team ?? "A", forceGM: !!x.forceGM });
    }
  }

  async #checkReady() {
    if (!this.participants.length) {
      ui.notifications.warn(game.i18n.localize("ROLLENSEMBLECOC7.Config.NoParticipantsWarning"));
      return false;
    }
    if (!this.selectedSkill) {
      ui.notifications.warn(game.i18n.localize("ROLLENSEMBLECOC7.Config.NoSkillWarning"));
      return false;
    }
    return true;
  }

  /**
   * "Lancer !" — le MJ lance immédiatement pour TOUS les participants
   * actuellement sélectionnés, sans passer par une requête joueur.
   */
  static async #onLaunch(event, target) {
    this.#sync();
    if (!(await this.#checkReady())) return;

    const requiredRank = this.adversaire.on ? null : (this.difficulty !== "none" ? RANK[this.difficulty] : null);
    const skillDisplayLabel = this.#skillDisplayLabel();
    const rollId = makeRollId();

    const participants = [];
    const jets = [];
    for (const p of this.participants) {
      const actor = p.actorUuid ? await fromUuid(p.actorUuid) : null;
      const { noSkill, effectiveSkill } = await this.#resolveEffectiveSkill(p, actor);
      const { jet, res } = await this.#jetGardien(effectiveSkill, p.dice, requiredRank);
      jets.push(jet);
      participants.push({ ...p, skillLabel: skillDisplayLabel, effectiveSkill, noSkill, pending: false, ...res });
    }
    const { adversaire, jet: jetAdv } = await this.#lancerAdversaire();

    const payload = { ...this.#buildBasePayload(rollId, skillDisplayLabel), participants, adversaire, winners: null };

    // Dice So Nice : la bannière fait défiler les chiffres pendant que les dés roulent, puis révèle
    payload.attente3d = dsnActif() && enBanniere();
    registerRoll(payload, []);
    broadcast("start", payload);
    ouvrirAffichage(payload);
    if (this.rendered) this.close();
    const n = participants.length + (adversaire ? 1 : 0);
    if (payload.attente3d) {
      await this.#montrerTout(jets, jetAdv, payload);
      diffuser("reveal", { id: rollId });
      Banniere.revelerTout(rollId);
      setTimeout(() => apresJets(rollId), 200 + n * payload.staggerMs + 500);
    } else {
      this.#montrerTout(jets, jetAdv, payload);
      setTimeout(() => apresJets(rollId), payload.rollDurationMs + n * payload.staggerMs + 500);
    }
  }

  #montrerTout(jets, jetAdv, payload) {
    const p = [montrerDes(jets, payload.cache)];
    if (jetAdv) p.push(montrerDes([jetAdv], payload.cache || payload.adversaire?.cache));
    return Promise.all(p);
  }

  /**
   * "Envoyer la requête" — n'inclut que les participants actuellement
   * sélectionnés qui ont un joueur propriétaire actif (et non basculés en
   * "Jet MJ" via le badge) ; chacun reçoit une demande et lance lui-même.
   * Les autres participants de la liste sont ignorés par cette action.
   */
  static async #onSendRequest(event, target) {
    this.#sync();
    if (!(await this.#checkReady())) return;

    const requiredRank = this.adversaire.on ? null : (this.difficulty !== "none" ? RANK[this.difficulty] : null);
    const skillDisplayLabel = this.#skillDisplayLabel();
    const rollId = makeRollId();

    const participants = [];
    const requests = [];

    const jetsGardien = [];
    for (const p of this.participants) {
      const actor = p.actorUuid ? await fromUuid(p.actorUuid) : null;
      const owners = actor ? getActiveOwners(actor) : [];
      if (p.forceGM || !owners.length) {
        // Sans joueur connecté (PNJ, joueur absent) : le Gardien lance tout de suite
        const { noSkill, effectiveSkill } = await this.#resolveEffectiveSkill(p, actor);
        const { jet, res } = await this.#jetGardien(effectiveSkill, p.dice, requiredRank);
        jetsGardien.push(jet);
        participants.push({ ...p, skillLabel: skillDisplayLabel, effectiveSkill, noSkill, pending: false, ...res });
        continue;
      }

      const { noSkill, effectiveSkill } = await this.#resolveEffectiveSkill(p, actor);
      participants.push({
        ...p, skillLabel: skillDisplayLabel, effectiveSkill, noSkill,
        pending: true, roll: null, level: null, rank: -1, meetsThreshold: null
      });
      requests.push({
        userIds: owners.map(u => u.id),
        key: p.key,
        name: p.name,
        img: p.img,
        actorUuid: p.actorUuid,
        skillLabel: skillDisplayLabel,
        effectiveSkill,
        dice: p.dice,
        requiredRank,
        cache: this.cache,
        rollId,
        label: this.label || skillDisplayLabel
      });
    }

    if (!requests.length) {
      ui.notifications.warn(game.i18n.localize("ROLLENSEMBLECOC7.Config.NoEligiblePlayers"));
      return;
    }

    const { adversaire, jet: jetAdv } = await this.#lancerAdversaire();
    const payload = {
      ...this.#buildBasePayload(rollId, skillDisplayLabel),
      participants,
      adversaire,
      winners: null
    };

    registerRoll(payload, requests.map(r => r.key));
    broadcast("start", payload);
    ouvrirAffichage(payload);
    this.#montrerTout(jetsGardien, jetAdv, payload);
    for (const req of requests) broadcast("roll-request", req);
    ui.notifications.info(game.i18n.format("ROLLENSEMBLECOC7.Config.RequestsSent", { count: requests.length }));

    if (this.rendered) this.close();
  }

  static async #onSaveMacro() {
    this.#sync();
    if (!(await this.#checkReady())) return;
    await creerMacroFavori(this.versFavori(), this.label || this.#skillDisplayLabel());
  }
}
