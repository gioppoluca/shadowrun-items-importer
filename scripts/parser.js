import { SII } from "./constants.js";
import { ShadowrunItemsImporterUtils as Utils } from "./utils.js";
import { QualityItemParser } from "./parsers/items/quality-item-parser.js";
import { MetamagicItemParser } from "./parsers/items/metamagic-item-parser.js";
import { GearChemicalsToxinsParser } from "./parsers/items/gear-chemicals-toxins-parser.js";
import { SpellItemParser } from "./parsers/items/spell-item-parser.js";
import { GearWeaponParser } from "./parsers/items/gear-weapon-parser.js";
import { GearWeaponAccessoryParser } from "./parsers/items/gear-weapon-accessory-parser.js";
import { GearCyberwareHeadwareParser } from "./parsers/items/cyberware/gear-cyberware-headware-parser.js";

export class ShadowrunItemsImporterParser {
  isCyberwareHeadwareInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "");

    return normalizedType.includes("CYBER_HEADWARE")
      || /^HEADWARE\s+ESSENCE\s+CAPACITY\s+AVAIL\s+COST\b/mi.test(normalizedText);
  }

  isWeaponAccessoryInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "");

    return normalizedType.includes("ACCESSOR")
      || /^ACCESSORY\s+MOUNT\s+AVAILABILITY\s+COST\b/mi.test(normalizedText);
  }

  parseInput(rawText, folderId, itemType) {
    if (!globalThis.ohm) {
      throw new Error("Ohm.js is required but was not found on globalThis.ohm");
    }

    let parser;
    console.log("Creating parser for type:", itemType, folderId, rawText);

    if (this.isCyberwareHeadwareInput(itemType, rawText)) {
      parser = new GearCyberwareHeadwareParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isWeaponAccessoryInput(itemType, rawText)) {
      parser = new GearWeaponAccessoryParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (itemType.startsWith("gear.WEAPON")) {
      parser = new GearWeaponParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    switch (itemType) {
      case "quality":
        parser = new QualityItemParser({ text: rawText, type: itemType, folderId });
        break;
      case "metamagic":
        parser = new MetamagicItemParser({ text: rawText, type: itemType, folderId });
        break;
      case "gear.CHEMICALS.TOXINS":
        parser = new GearChemicalsToxinsParser({ text: rawText, type: itemType, folderId });
        break;
      case "spell":
        parser = new SpellItemParser({ text: rawText, type: itemType, folderId });
        break;
      default:
        ui.notifications?.warn(`${game.i18n.localize(CONFIG.Item.typeLabels[itemType])} is not supported yet.`);
        return null;
    }

    return parser.parse();
  }
}


