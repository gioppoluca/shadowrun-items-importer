import { SII } from "./constants.js";

export class ShadowrunItemsImporterConfig {
  static registerSettings() {
    game.settings.register(SII.MODULE_ID, SII.SETTINGS.DEBUG, {
      name: `${SII.MODULE_ID}.settings.debug.name`,
      hint: `${SII.MODULE_ID}.settings.debug.hint`,
      scope: "client",
      config: true,
      type: Boolean,
      default: false
    });

    game.settings.register(SII.MODULE_ID, SII.SETTINGS.REMEMBER_FOLDER, {
      name: `${SII.MODULE_ID}.settings.rememberFolder.name`,
      hint: `${SII.MODULE_ID}.settings.rememberFolder.hint`,
      scope: "client",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register(SII.MODULE_ID, SII.SETTINGS.LAST_FOLDER, {
      name: `${SII.MODULE_ID}.settings.lastFolder.name`,
      hint: `${SII.MODULE_ID}.settings.lastFolder.hint`,
      scope: "client",
      config: false,
      type: String,
      default: ""
    });

    game.settings.register(SII.MODULE_ID, SII.SETTINGS.LAST_TYPE, {
      name: `${SII.MODULE_ID}.settings.lastType.name`,
      hint: `${SII.MODULE_ID}.settings.lastType.hint`,
      scope: "client",
      config: false,
      type: String,
      default: ""
    });
  }
}
