import { SII } from "./constants.js";

export class ShadowrunItemsImporterUtils {

  static ACTIVE_ITEM_TYPES = Object.freeze([
    "critterpower",
    "focus",
    "gear",
    "metamagic",
    "quality",
    "software",
    "spell"
  ]);

  static ACTIVE_GEAR_SUBTYPES = Object.freeze([
    // Generic gear parsers.
    "ACCESSORY.ACCESSORY",
    "ARMOR.*",
    "CHEMICALS.TOXINS",

    // Electronics / Matrix gear.
    "ELECTRONICS.COMMLINK",
    "ELECTRONICS.CYBERDECK",
    "SOFTWARE.BASIC_PROGRAM",
    "SOFTWARE.HACKING_PROGRAM",
    "SOFTWARE.RIGGER_PROGRAM",
    "SOFTWARE.OTHER_PROGRAMS",

    // Cyberware / bioware parsers.
    "BIOWARE.BIOWARE_STANDARD",
    "BIOWARE.BIOWARE_CULTURED",
    "CYBERWARE.CYBER_HEADWARE",
    "CYBERWARE.CYBERJACK",
    "CYBERWARE.CYBER_BODYWARE",
    "CYBERWARE.CYBER_EYEWARE",
    "CYBERWARE.CYBER_EARWARE",
    "CYBERWARE.CYBER_LIMBS",
    "CYBERWARE.COMMLINK",
    "CYBERWARE.CYBERDECK",

    // Vehicles and drones.
    "VEHICLES.*",
    "DRONES.*",
    "DRONE_MICRO.*",
    "DRONE_MINI.*",
    "DRONE_SMALL.*",
    "DRONE_MEDIUM.*",
    "DRONE_LARGE.*",

    // Weapon tables.
    "WEAPON_CLOSE_COMBAT.*",
    "WEAPON_FIREARMS.*",
    "WEAPON_RANGED.*",
    "WEAPON_SPECIAL.*"
  ]);

  static isActiveItemParser(itemType) {
    const normalizedType = String(itemType ?? "").trim().toLowerCase();
    if (!normalizedType) return false;
    return this.ACTIVE_ITEM_TYPES.includes(normalizedType);
  }

  static isActiveGearParser(gearType, gearSubtype = "") {
    const normalizedType = String(gearType ?? "").trim().toUpperCase();
    const normalizedSubtype = String(gearSubtype ?? "").trim().toUpperCase();
    if (!normalizedType) return false;

    const exactKey = `${normalizedType}.${normalizedSubtype}`;
    const wildcardKey = `${normalizedType}.*`;

    return this.ACTIVE_GEAR_SUBTYPES.includes(exactKey)
      || this.ACTIVE_GEAR_SUBTYPES.includes(wildcardKey);
  }

  static isActiveGearType(gearType) {
    const normalizedType = String(gearType ?? "").trim().toUpperCase();
    if (!normalizedType) return false;

    return this.ACTIVE_GEAR_SUBTYPES.some((entry) => {
      const [type] = String(entry ?? "").split(".");
      return type === normalizedType;
    });
  }

  static optionWithParserStatus(option, parserActive) {
    return {
      ...option,
      parserActive: Boolean(parserActive),
      parserStatusClass: parserActive ? "sii-option-parser-active" : ""
    };
  }
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
