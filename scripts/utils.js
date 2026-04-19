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

  static getAvailableItemTypes() {
    const types = new Set();

    const metadataTypes = CONFIG.Item?.documentClass?.metadata?.types;
    if (Array.isArray(metadataTypes)) {
      for (const t of metadataTypes) types.add(t);
    }

    const configDataModels = CONFIG.Item?.dataModels;
    if (configDataModels && typeof configDataModels === "object") {
      for (const t of Object.keys(configDataModels)) types.add(t);
    }

    const templateItemTypes = game.system?.model?.Item;
    if (templateItemTypes && typeof templateItemTypes === "object") {
      for (const t of Object.keys(templateItemTypes)) types.add(t);
    }

    return [...types].sort((a, b) => a.localeCompare(b));
  }

  static getItemFolders() {
    return game.folders.filter((folder) => folder.type === "Item");
  }

  static formatTypeLabel(type) {
    return String(type)
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  static getOhm() {
    return globalThis.ohm ?? globalThis.ohmJs ?? globalThis.Ohm ?? null;
  }

  /**
 * Returns the SR6 gear type config object if present.
 * Some systems expose GEAR_TYPE, others GEAR_TYPES.
 */
  static getSr6GearTypeConfig() {
    const sr6 = globalThis.CONFIG?.SR6;
    if (!sr6 || typeof sr6 !== "object") return null;

    return sr6.GEAR_TYPES;
  }

  /**
   * Returns select options from CONFIG.SR6 gear type config.
   * Expected shape:
   * {
   *   quality: "SR6.ItemTypes.Quality",
   *   weapon: "SR6.ItemTypes.Weapon"
   * }
   */
  static getItemTypeOptions() {
    return Object.entries(CONFIG.Item.typeLabels)
      .filter(([key]) => key !== "base")
      .map(([key, translationKey]) => ({
        value: key,
        label: game.i18n.localize(translationKey)
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }


}
