import { SII } from "./constants.js";

export class ShadowrunItemsImporterUtils {
  static log(...args) {
    if (game.settings?.get(SII.MODULE_ID, SII.SETTINGS.DEBUG)) {
      console.log(`[${SII.MODULE_ID}]`, ...args);
    }
  }

  static isSupportedSystem() {
    return SII.TARGET_SYSTEMS.includes(game.system.id);
  }

  static getItemFolders() {
    return game.folders.filter((folder) => folder.type === "Item");
  }

  static getOhm() {
    return globalThis.ohm ?? globalThis.ohmJs ?? globalThis.Ohm ?? null;
  }

  static getItemTypeOptions() {
    return Object.entries(CONFIG.Item.typeLabels)
      .filter(([key]) => key !== "base")
      .map(([key, translationKey]) => ({
        value: key,
        label: game.i18n.localize(translationKey)
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  static getGearTypeOptions() {
    return Object.entries(CONFIG.SR6.GEAR_TYPES).map(([key, translationKey]) => ({
      value: key,
      label: game.i18n.localize(translationKey)
    }));
  }

  static getGearSubtypeOptions(gearType) {
    const subtypes = CONFIG.SR6.GEAR_SUBTYPES[gearType] ?? {};
    return Object.entries(subtypes).map(([key, translationKey]) => ({
      value: key,
      label: game.i18n.localize(translationKey)
    }));
  }
}
