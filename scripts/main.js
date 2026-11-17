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

/* Bouton dans la barre de gauche (outils des jetons), visible du Gardien seulement */
Hooks.on("getSceneControlButtons", (controls) => {
  const jetons = controls?.tokens ?? controls?.token;
  if (!jetons?.tools || Array.isArray(jetons.tools)) return;
  jetons.tools.rollEnsemble = {
    name: "rollEnsemble",
    title: "ROLLENSEMBLECOC7.Bouton",
    icon: "fa-solid fa-dice",
    order: Object.keys(jetons.tools).length,
    button: true,
    visible: game.user.isGM,
    onChange: () => new RollConfigApp().render(true)
  };
});

/* Macro « Lancer de groupe » avec son icône, créée une seule fois pour le Gardien (dossier « Outils CoC7 ») */
Hooks.once("ready", async () => {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  await macroStreamDeck();
  if (game.settings.get("roll-ensemble-coc7", "macroCreee")) return;
  try {
    const nomDossier = "Outils CoC7";
    let dossier = game.folders.find((f) => f.type === "Macro" && f.name === nomDossier);
    dossier ??= await Folder.create({ name: nomDossier, type: "Macro", color: "#4fb3a6" });
    const data = {
      name: "Lancer de groupe", type: "script", folder: dossier.id,
      img: "modules/roll-ensemble-coc7/icons/macros/lancer-groupe.svg",
      command: 'const mod = game.modules.get("roll-ensemble-coc7");\nif (!mod?.active) return ui.notifications.warn("Le module « Roll Ensemble — CoC7 » n\'est pas activé.");\nmod.api.ouvrir();'
    };
    const deja = game.macros.find((m) => m.name === data.name && m.folder?.id === dossier.id);
    if (deja) await deja.update(data); else await Macro.create(data);
    await game.settings.set("roll-ensemble-coc7", "macroCreee", true);
    ui.notifications.info(game.i18n.localize("ROLLENSEMBLECOC7.MacroCreee"));
  } catch (e) {
    console.warn("roll-ensemble-coc7 | macro", e);
  }
});

/**
 * Avec le module Commandes Stream Deck : macro « SD 45 · Lancer de groupe » (touche Alt+F21),
 * créée une fois dans le dossier « Stream Deck » si l'emplacement 45 est libre.
 */
async function macroStreamDeck() {
  if (!game.modules.get("commandes-stream-deck")?.active) return;
  if (game.settings.get("roll-ensemble-coc7", "macroSD")) return;
  try {
    if (game.macros.some((m) => m.name === "SD 45" || m.name.startsWith("SD 45 "))) {
      await game.settings.set("roll-ensemble-coc7", "macroSD", true);
      return;
    }
    let dossier = game.folders.find((f) => f.type === "Macro" && f.name === "Stream Deck");
    dossier ??= await Folder.create({ name: "Stream Deck", type: "Macro" });
    await Macro.create({
      name: "SD 45 · Lancer de groupe", type: "script", folder: dossier.id,
      img: "modules/roll-ensemble-coc7/icons/macros/lancer-groupe.svg",
      command: 'game.modules.get("roll-ensemble-coc7")?.api?.ouvrir();'
    });
    await game.settings.set("roll-ensemble-coc7", "macroSD", true);
    ui.notifications.info(game.i18n.localize("ROLLENSEMBLECOC7.MacroSD"));
  } catch (e) {
    console.warn("roll-ensemble-coc7 | macro Stream Deck", e);
  }
}
