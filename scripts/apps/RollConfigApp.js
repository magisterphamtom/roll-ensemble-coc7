import { MODULE_ID } from "../settings.js";
import { broadcast } from "../lib/socket.js";
import { rollPercentile, successLevel, determineWinners, makeRollId, RANK } from "../lib/coc7.js";
import {
  getActorSkills, getSkillValueByLabel, CHARACTERISTICS, getCharacteristicValue,
  SPECIAL_ATTRIBUTES, getSpecialAttributeValue, getActiveOwners
} from "../lib/actor-skills.js";
import { registerPendingRoll } from "../lib/roll-manager.js";
import { postChatRecap } from "../lib/chat-recap.js";
import { SpectatorApp } from "./SpectatorApp.js";

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
    position: { width: 860, height: 620 },
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
      sendRequest: RollConfigApp.#onSendRequest
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
  globalDice = 0; // dés bonus/malus par défaut appliqués à tous
  search = "";
  /** @type {{kind: "skill"|"char"|"special", label: string, key?: string}|null} */
  selectedSkill = null;

  async _prepareContext() {
    const resolvedActors = await Promise.all(
      this.participants.map(p => (p.actorUuid ? fromUuid(p.actorUuid) : null))
    );

    // Liste unique (dédupliquée) des compétences présentes chez au moins un participant sélectionné
    const skillLabels = new Set();
    resolvedActors.forEach(actor => {
      getActorSkills(actor).forEach(s => skillLabels.add(s.label));
    });
    const skillOptions = [...skillLabels].sort((a, b) => a.localeCompare(b)).map(label => ({
      label,
      selected: this.selectedSkill?.kind === "skill" && this.selectedSkill.label === label
    }));

    const charOptions = CHARACTERISTICS.map(c => ({
      key: c.key,
      label: c.label,
      selected: this.selectedSkill?.kind === "char" && this.selectedSkill.key === c.key
    }));

    const specialOptions = SPECIAL_ATTRIBUTES.map(c => ({
      key: c.key,
      label: c.label,
      selected: this.selectedSkill?.kind === "special" && this.selectedSkill.key === c.key
    }));

    // Tokens de la scène non encore sélectionnés, pour la colonne "Disponibles"
    const placeables = (canvas.tokens?.placeables ?? []).filter(t => t.actor);
    const available = placeables
      .filter(t => !this.participants.some(p => p.actorUuid === t.actor.uuid))
      .map(t => ({
        actorUuid: t.actor.uuid,
        name: t.name || t.actor.name,
        img: t.document.texture?.src || t.actor.img,
        sub: t.actor.hasPlayerOwner
          ? game.i18n.localize("ROLLENSEMBLECOC7.Config.PC")
          : game.i18n.localize("ROLLENSEMBLECOC7.Config.NPC")
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Grille dédiée : uniquement les tokens de personnages joueurs présents sur la scène,
    // pour une sélection rapide en un clic (indépendante de la recherche "Disponibles")
    const playerTokens = placeables
      .filter(t => t.actor.hasPlayerOwner)
      .map(t => ({
        actorUuid: t.actor.uuid,
        name: t.name || t.actor.name,
        img: t.document.texture?.src || t.actor.img,
        selected: this.participants.some(p => p.actorUuid === t.actor.uuid)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const selected = this.participants.map((p, i) => {
      const actor = resolvedActors[i];
      const owners = actor ? getActiveOwners(actor) : [];
      return {
        ...p,
        img: actor?.img ?? p.img,
        canRequest: owners.length > 0,
        willRequest: owners.length > 0 && !p.forceGM,
        ownerNames: owners.map(u => u.name).join(", ")
      };
    });

    return {
      label: this.label,
      teams: this.teams,
      difficulty: this.difficulty,
      globalDice: this.globalDice,
      selectedSkillLabel: this.#skillDisplayLabel(),
      available,
      playerTokens,
      selected,
      skillOptions,
      charOptions,
      specialOptions,
      hasParticipants: selected.length > 0
    };
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

    const dropZone = this.element.querySelector(".re-dropzone");
    if (dropZone) {
      dropZone.addEventListener("dragover", (ev) => ev.preventDefault());
      dropZone.addEventListener("drop", this._onDrop.bind(this));
    }

    // Filtrage en direct de la colonne "Disponibles" sans re-render complet
    const searchInput = this.element.querySelector(".re-search-input");
    if (searchInput) {
      searchInput.value = this.search;
      searchInput.addEventListener("input", (ev) => {
        this.search = ev.target.value;
        const needle = this.search.trim().toLowerCase();
        this.element.querySelectorAll(".re-available-list .re-actor-row").forEach(row => {
          const name = row.dataset.name ?? "";
          row.style.display = !needle || name.includes(needle) ? "" : "none";
        });
      });
    }
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
    this.#addActor(actor);
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

  static #onSelectSkill(event, target) {
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
    const key = target.closest("[data-key]")?.dataset.key;
    const p = this.participants.find(p => p.key === key);
    if (p) p.forceGM = !p.forceGM;
    this.render();
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    this.label = data.label ?? this.label;
    this.teams = !!data.teams;
    this.difficulty = data.difficulty ?? this.difficulty;
    this.globalDice = Number(data.globalDice) || 0;
    for (const p of this.participants) {
      if (data[`modifier-${p.key}`] !== undefined) p.modifier = Number(data[`modifier-${p.key}`]) || 0;
      if (data[`dice-${p.key}`] !== undefined) p.dice = Number(data[`dice-${p.key}`]) || 0;
      if (data[`team-${p.key}`] !== undefined) p.team = data[`team-${p.key}`];
    }
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
    return {
      id: rollId,
      label: this.label || skillDisplayLabel || game.i18n.localize("ROLLENSEMBLECOC7.ChatButton"),
      teams: this.teams,
      difficulty: this.difficulty,
      rollDurationMs: game.settings.get(MODULE_ID, "rollDurationMs"),
      staggerMs: game.settings.get(MODULE_ID, "staggerMs"),
      autoCloseSeconds: game.settings.get(MODULE_ID, "autoCloseSeconds"),
      playSound: game.settings.get(MODULE_ID, "playSound"),
      soundRoll: game.settings.get(MODULE_ID, "soundRoll"),
      soundComplete: game.settings.get(MODULE_ID, "soundComplete"),
      soundFumble: game.settings.get(MODULE_ID, "soundFumble")
    };
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
    const form = this.element;
    const formData = new foundry.applications.ux.FormDataExtended(form);
    await RollConfigApp.#onSubmit.call(this, event, form, formData);
    if (!(await this.#checkReady())) return;

    const requiredRank = this.difficulty !== "none" ? RANK[this.difficulty] : null;
    const skillDisplayLabel = this.#skillDisplayLabel();
    const rollId = makeRollId();

    const participants = [];
    for (const p of this.participants) {
      const actor = p.actorUuid ? await fromUuid(p.actorUuid) : null;
      const { noSkill, effectiveSkill } = await this.#resolveEffectiveSkill(p, actor);

      const bonusDice = p.dice > 0 ? p.dice : 0;
      const penaltyDice = p.dice < 0 ? -p.dice : 0;
      const { roll } = rollPercentile(bonusDice, penaltyDice);
      const level = successLevel(roll, effectiveSkill);
      const rank = RANK[level];
      participants.push({
        ...p, skillLabel: skillDisplayLabel, effectiveSkill, noSkill,
        pending: false, roll, level, rank,
        meetsThreshold: requiredRank === null ? null : rank >= requiredRank
      });
    }

    const payload = {
      ...this.#buildBasePayload(rollId, skillDisplayLabel),
      participants,
      winners: determineWinners(participants, this.teams)
    };

    broadcast("start", payload);
    new SpectatorApp(payload).render(true);
    await postChatRecap(payload);

    this.close();
  }

  /**
   * "Envoyer la requête" — n'inclut que les participants actuellement
   * sélectionnés qui ont un joueur propriétaire actif (et non basculés en
   * "Jet MJ" via le badge) ; chacun reçoit une demande et lance lui-même.
   * Les autres participants de la liste sont ignorés par cette action.
   */
  static async #onSendRequest(event, target) {
    const form = this.element;
    const formData = new foundry.applications.ux.FormDataExtended(form);
    await RollConfigApp.#onSubmit.call(this, event, form, formData);
    if (!(await this.#checkReady())) return;

    const requiredRank = this.difficulty !== "none" ? RANK[this.difficulty] : null;
    const skillDisplayLabel = this.#skillDisplayLabel();
    const rollId = makeRollId();

    const participants = [];
    const requests = [];

    for (const p of this.participants) {
      if (p.forceGM) continue;
      const actor = p.actorUuid ? await fromUuid(p.actorUuid) : null;
      const owners = actor ? getActiveOwners(actor) : [];
      if (!owners.length) continue;

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
        rollId,
        label: this.label || skillDisplayLabel
      });
    }

    if (!participants.length) {
      ui.notifications.warn(game.i18n.localize("ROLLENSEMBLECOC7.Config.NoEligiblePlayers"));
      return;
    }

    const payload = {
      ...this.#buildBasePayload(rollId, skillDisplayLabel),
      participants,
      winners: null
    };

    broadcast("start", payload);
    new SpectatorApp(payload).render(true);

    registerPendingRoll(payload, requests.map(r => r.key));
    for (const req of requests) broadcast("roll-request", req);
    ui.notifications.info(game.i18n.format("ROLLENSEMBLECOC7.Config.RequestsSent", { count: requests.length }));

    this.close();
  }
}
