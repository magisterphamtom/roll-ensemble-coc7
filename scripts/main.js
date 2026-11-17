import { MODULE_ID, registerSettings } from "./settings.js";
import { initSocket } from "./lib/socket.js";
import { handleRollResponse, handleAjustement } from "./lib/roll-manager.js";
import { RollConfigApp } from "./apps/RollConfigApp.js";
import { Banniere } from "./apps/Banniere.js";
import { ouvrirAffichage, appliquerResultat, finaliserAffichage, enBanniere } from "./lib/affichage.js";
import { RollRequestApp } from "./apps/RollRequestApp.js";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  initSocket({
    start: (payload) => ouvrirAffichage(payload),
    "roll-request": (data) => {
      if (data.userIds?.includes(game.user.id)) {
        // Bannière : le joueur lance depuis son portrait ; sinon, l'ancienne petite fenêtre
        if (!enBanniere()) new RollRequestApp(data).render(true);
        ui.notifications.info(game.i18n.format("ROLLENSEMBLECOC7.Request.Notification", { name: data.name }));
      }
    },
    "roll-response": (data) => {
      appliquerResultat(data);
      if (game.user.isGM) handleRollResponse(data);
    },
    reveal: (data) => Banniere.revelerTout(data.id),
    rattrapage: (data) => Banniere.rattrapage(data.id),
    ajustement: (data) => {
      Banniere.ajuster(data);
      if (game.user.isGM) handleAjustement(data);
    },
    "results-final": (payload) => {
      finaliserAffichage(payload);
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

/* API : ouvrir la préparation, lancer un favori (macros) */
Hooks.once("ready", () => {
  const mod = game.modules.get("roll-ensemble-coc7");
  mod.api = {
    ouvrir: () => new RollConfigApp().render(true),
    async lancerFavori(favori, { ouvrir = false } = {}) {
      if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("ROLLENSEMBLECOC7.Favori.MJ"));
      const app = new RollConfigApp();
      await app.depuisFavori(favori);
      if (ouvrir) return app.render(true);
      return app.executer("auto");
    }
  };
});
