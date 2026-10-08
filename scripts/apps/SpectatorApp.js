import { MODULE_ID } from "../settings.js";
import { LEVEL_COLOR } from "../lib/coc7.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LEVEL_LABEL_KEY = {
  fumble: "ROLLENSEMBLECOC7.Level.fumble",
  fail: "ROLLENSEMBLECOC7.Level.fail",
  regular: "ROLLENSEMBLECOC7.Level.regular",
  hard: "ROLLENSEMBLECOC7.Level.hard",
  extreme: "ROLLENSEMBLECOC7.Level.extreme",
  critical: "ROLLENSEMBLECOC7.Level.critical"
};

/** @type {Map<string, SpectatorApp>} rollId -> instance ouverte sur ce client */
const registry = new Map();

export class SpectatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(payload, options = {}) {
    super(options);
    this.payload = payload;
    registry.set(payload.id, this);
  }

  /** Applique le résultat d'un joueur qui vient de lancer, sur toute instance ouverte pour ce rollId. */
  static applyResult(data) {
    const instance = registry.get(data.rollId);
    if (instance) instance.revealParticipant(data);
  }

  /** Finalise un lancer (vainqueurs connus) sur toute instance ouverte pour ce rollId. */
  static finalizeAny(payload) {
    const instance = registry.get(payload.id);
    if (instance) instance.finalize(payload);
  }

  static DEFAULT_OPTIONS = {
    id: "roll-ensemble-coc7-spectator",
    window: {
      title: "ROLLENSEMBLECOC7.Spectator.Title",
      icon: "fa-solid fa-dice-d10",
      resizable: false
    },
    position: { width: 460, height: "auto" }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/spectator-view.hbs` }
  };

  async _prepareContext() {
    return {
      label: this.payload.label,
      teams: this.payload.teams,
      participants: this.payload.participants
    };
  }

  get title() {
    return this.payload.label || game.i18n.localize("ROLLENSEMBLECOC7.Spectator.Title");
  }

  _onClose(options) {
    super._onClose?.(options);
    if (registry.get(this.payload.id) === this) registry.delete(this.payload.id);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#runAnimation();
  }

  async #runAnimation() {
    const { participants, rollDurationMs, staggerMs, playSound, soundRoll } = this.payload;

    if (playSound && soundRoll) {
      foundry.audio.AudioHelper.play({ src: soundRoll, volume: 0.8, autoplay: true, loop: false }, false);
    }

    const rows = [...this.element.querySelectorAll(".re-participant")];
    this.spinTimers = new Map();

    // Les participants en attente d'un joueur affichent un état "patiente", sans animation locale
    const resolvedRows = [];
    rows.forEach((row) => {
      const key = row.dataset.key;
      const participant = participants.find(p => p.key === key);
      if (participant?.pending) {
        row.classList.add("re-pending");
        return;
      }
      resolvedRows.push(row);
      const valueEl = row.querySelector(".re-value");
      if (!valueEl) return;
      const timer = setInterval(() => {
        valueEl.textContent = String(Math.ceil(Math.random() * 100)).padStart(2, "0");
      }, 60);
      this.spinTimers.set(key, timer);
    });

    const revealOne = (row, index) => {
      return new Promise((resolve) => {
        const delay = rollDurationMs + index * staggerMs;
        setTimeout(() => {
          const key = row.dataset.key;
          this.#applyRevealToRow(row, participants.find(p => p.key === key));
          resolve();
        }, delay);
      });
    };

    await Promise.all(resolvedRows.map((row, i) => revealOne(row, i)));

    // S'il reste des participants en attente d'un joueur, on ne connaît pas encore
    // le vainqueur : on patiente pour le message "results-final" du MJ.
    const stillPending = participants.some(p => p.pending);
    if (!stillPending) {
      this.#showWinnersAndFinish();
    }
  }

  #applyRevealToRow(row, participant) {
    if (!participant) return;
    const timer = this.spinTimers?.get(participant.key);
    if (timer) clearInterval(timer);

    const valueEl = row.querySelector(".re-value");
    const levelEl = row.querySelector(".re-level");
    const thresholdEl = row.querySelector(".re-threshold");
    if (valueEl) valueEl.textContent = String(participant.roll).padStart(2, "0");
    if (levelEl) {
      levelEl.textContent = game.i18n.localize(LEVEL_LABEL_KEY[participant.level]);
      levelEl.style.color = LEVEL_COLOR[participant.level];
    }
    if (thresholdEl && participant.meetsThreshold !== null && participant.meetsThreshold !== undefined) {
      const pass = participant.meetsThreshold;
      thresholdEl.textContent = game.i18n.localize(pass ? "ROLLENSEMBLECOC7.Threshold.Success" : "ROLLENSEMBLECOC7.Threshold.Failure");
      thresholdEl.classList.add(pass ? "re-threshold-pass" : "re-threshold-fail");
    }
    row.style.setProperty("--level-color", LEVEL_COLOR[participant.level]);
    row.classList.remove("re-pending");
    row.classList.add("re-revealed", `re-level-${participant.level}`);
    if (participant.noSkill) row.classList.add("re-no-skill");
  }

  /**
   * Reçoit le jet d'un joueur qui vient de répondre à une requête et
   * déclenche une petite animation de révélation pour sa carte.
   */
  revealParticipant(data) {
    const participant = this.payload.participants.find(p => p.key === data.key);
    if (!participant) return;
    Object.assign(participant, {
      roll: data.roll,
      level: data.level,
      rank: data.rank,
      meetsThreshold: data.meetsThreshold,
      pending: false
    });

    const row = this.element.querySelector(`.re-participant[data-key="${data.key}"]`);
    if (!row) return;

    const valueEl = row.querySelector(".re-value");
    let ticks = 0;
    const spin = setInterval(() => {
      if (valueEl) valueEl.textContent = String(Math.ceil(Math.random() * 100)).padStart(2, "0");
      ticks++;
      if (ticks >= 8) {
        clearInterval(spin);
        this.#applyRevealToRow(row, participant);
      }
    }, 60);
  }

  /** Reçoit la résolution finale (vainqueurs) une fois tous les jets rentrés. */
  finalize(finalPayload) {
    this.payload = finalPayload;
    // Filet de sécurité : force l'affichage de toute carte qui n'aurait pas
    // encore été révélée visuellement.
    this.element.querySelectorAll(".re-participant.re-pending").forEach((row) => {
      const key = row.dataset.key;
      const participant = finalPayload.participants.find(p => p.key === key);
      if (participant) this.#applyRevealToRow(row, participant);
    });
    this.#showWinnersAndFinish();
  }

  #showWinnersAndFinish() {
    const { participants, winners, teams, playSound, soundComplete, soundFumble } = this.payload;
    if (!winners) return;

    const rows = this.element.querySelectorAll(".re-participant");
    rows.forEach((row) => {
      const key = row.dataset.key;
      if (winners.winnerKeys?.includes(key)) row.classList.add("re-winner");
    });

    const anyFumble = participants.some(p => p.level === "fumble");
    if (playSound) {
      if (anyFumble && soundFumble) {
        foundry.audio.AudioHelper.play({ src: soundFumble, volume: 0.8, autoplay: true, loop: false }, false);
      } else if (soundComplete) {
        foundry.audio.AudioHelper.play({ src: soundComplete, volume: 0.8, autoplay: true, loop: false }, false);
      }
    }

    const banner = this.element.querySelector(".re-winner-banner");
    if (banner) {
      let text = "";
      if (teams) {
        if (winners.winningTeam === "A") text = game.i18n.localize("ROLLENSEMBLECOC7.Spectator.TeamAWins");
        else if (winners.winningTeam === "B") text = game.i18n.localize("ROLLENSEMBLECOC7.Spectator.TeamBWins");
        else text = game.i18n.localize("ROLLENSEMBLECOC7.Spectator.Tie");
      } else {
        const names = participants.filter(p => winners.winnerKeys.includes(p.key)).map(p => p.name).join(", ");
        const label = game.i18n.localize(winners.winnerKeys.length > 1 ? "ROLLENSEMBLECOC7.Spectator.Winners" : "ROLLENSEMBLECOC7.Spectator.Winner");
        text = `${label} : ${names}`;
      }
      banner.textContent = text;
      banner.classList.add("re-visible");
    }

    const autoCloseSeconds = this.payload.autoCloseSeconds ?? 0;
    if (autoCloseSeconds > 0) {
      setTimeout(() => this.close(), autoCloseSeconds * 1000);
    }
  }
}
