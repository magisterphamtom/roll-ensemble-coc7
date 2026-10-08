import { MODULE_ID, registerSettings } from "./settings.js";
import { initSocket } from "./lib/socket.js";
import { handleRollResponse } from "./lib/roll-manager.js";
import { RollConfigApp } from "./apps/RollConfigApp.js";
import { SpectatorApp } from "./apps/SpectatorApp.js";
import { RollRequestApp } from "./apps/RollRequestApp.js";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  initSocket({
    start: (payload) => {
      new SpectatorApp(payload).render(true);
    },
    "roll-request": (data) => {
      if (data.userIds?.includes(game.user.id)) {
        new RollRequestApp(data).render(true);
        ui.notifications.info(game.i18n.format("ROLLENSEMBLECOC7.Request.Notification", { name: data.name }));
      }
    },
    "roll-response": (data) => {
      SpectatorApp.applyResult(data);
      if (game.user.isGM) handleRollResponse(data);
    },
    "results-final": (payload) => {
      SpectatorApp.finalizeAny(payload);
    }
  });

  if (game.system.id !== "CoC7") {
    console.warn(`${MODULE_ID} | Ce module lit les compétences au format du système CoC7 ; le monde actif utilise "${game.system.id}".`);
  }
});

Hooks.on("renderChatLog", (app, html) => {
  if (!game.user.isGM) return;

  const root = html instanceof HTMLElement ? html : html[0];
  const controls = root.querySelector("#chat-controls") ?? root.querySelector(".chat-controls");
  const target = controls ?? root.querySelector("#chat-form");
  if (!target || target.querySelector(".re-open-config")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("re-open-config");
  button.innerHTML = `<i class="fa-solid fa-dice-d10"></i> ${game.i18n.localize("ROLLENSEMBLECOC7.ChatButton")}`;
  button.addEventListener("click", () => new RollConfigApp().render(true));

  target.insertAdjacentElement("beforebegin", button);
});
