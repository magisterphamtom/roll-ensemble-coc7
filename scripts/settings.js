export const MODULE_ID = "roll-ensemble-coc7";

export function registerSettings() {
  game.settings.register(MODULE_ID, "playSound", {
    name: "ROLLENSEMBLECOC7.Settings.PlaySound",
    hint: "ROLLENSEMBLECOC7.Settings.PlaySoundHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "soundRoll", {
    name: "ROLLENSEMBLECOC7.Settings.SoundRoll",
    hint: "ROLLENSEMBLECOC7.Settings.SoundRollHint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "audio",
    default: ""
  });

  game.settings.register(MODULE_ID, "soundComplete", {
    name: "ROLLENSEMBLECOC7.Settings.SoundComplete",
    hint: "ROLLENSEMBLECOC7.Settings.SoundCompleteHint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "audio",
    default: ""
  });

  game.settings.register(MODULE_ID, "soundFumble", {
    name: "ROLLENSEMBLECOC7.Settings.SoundFumble",
    hint: "ROLLENSEMBLECOC7.Settings.SoundFumbleHint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "audio",
    default: ""
  });

  game.settings.register(MODULE_ID, "rollDurationMs", {
    name: "ROLLENSEMBLECOC7.Settings.RollDuration",
    hint: "ROLLENSEMBLECOC7.Settings.RollDurationHint",
    scope: "world",
    config: true,
    type: Number,
    default: 1500
  });

  game.settings.register(MODULE_ID, "staggerMs", {
    name: "ROLLENSEMBLECOC7.Settings.StaggerDelay",
    hint: "ROLLENSEMBLECOC7.Settings.StaggerDelayHint",
    scope: "world",
    config: true,
    type: Number,
    default: 500
  });

  game.settings.register(MODULE_ID, "autoCloseSeconds", {
    name: "ROLLENSEMBLECOC7.Settings.AutoClose",
    hint: "ROLLENSEMBLECOC7.Settings.AutoCloseHint",
    scope: "world",
    config: true,
    type: Number,
    default: 8
  });
}
