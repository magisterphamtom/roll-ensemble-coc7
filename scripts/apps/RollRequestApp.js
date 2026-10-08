import { MODULE_ID } from "../settings.js";
import { rollPercentile, successLevel, RANK } from "../lib/coc7.js";
import { broadcast } from "../lib/socket.js";
import { SpectatorApp } from "./SpectatorApp.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RollRequestApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @param {object} data  { rollId, key, name, img, actorUuid, skillLabel, effectiveSkill, dice, requiredRank, label } */
  constructor(data, options = {}) {
    super(options);
    this.data = data;
    this.resolved = false;
  }

  static DEFAULT_OPTIONS = {
    id: "roll-ensemble-coc7-request",
    window: {
      title: "ROLLENSEMBLECOC7.Request.Title",
      icon: "fa-solid fa-dice-d10",
      resizable: false
    },
    position: { width: 340, height: "auto" },
    actions: {
      roll: RollRequestApp.#onRoll
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/roll-request.hbs` }
  };

  async _prepareContext() {
    return { ...this.data };
  }

  get title() {
    return this.data.label || game.i18n.localize("ROLLENSEMBLECOC7.Request.Title");
  }

  static #onRoll(event, target) {
    if (this.resolved) return;
    this.resolved = true;
    target.disabled = true;

    const bonusDice = this.data.dice > 0 ? this.data.dice : 0;
    const penaltyDice = this.data.dice < 0 ? -this.data.dice : 0;
    const { roll } = rollPercentile(bonusDice, penaltyDice);
    const level = successLevel(roll, this.data.effectiveSkill);
    const rank = RANK[level];
    const meetsThreshold = this.data.requiredRank === null || this.data.requiredRank === undefined
      ? null
      : rank >= this.data.requiredRank;

    const result = { rollId: this.data.rollId, key: this.data.key, roll, level, rank, meetsThreshold };

    // Applique localement (le MJ et les autres clients recevront le broadcast,
    // mais celui-ci n'atteint pas l'émetteur lui-même)
    SpectatorApp.applyResult(result);
    broadcast("roll-response", result);

    ui.notifications.info(game.i18n.format("ROLLENSEMBLECOC7.Request.Rolled", { roll, name: this.data.name }));
    this.close();
  }
}
