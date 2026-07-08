import { SII } from "./constants.js";
import { ShadowrunItemsImporterUtils as Utils } from "./utils.js";
import { QualityItemParser } from "./parsers/items/quality-item-parser.js";
import { MetamagicItemParser } from "./parsers/items/metamagic-item-parser.js";
import { GearChemicalsToxinsParser } from "./parsers/items/gear-chemicals-toxins-parser.js";
import { SpellItemParser } from "./parsers/items/spell-item-parser.js";
import { FocusItemParser } from "./parsers/items/focus-item-parser.js";
import { GearWeaponParser } from "./parsers/items/gear-weapon-parser.js";
import { GearWeaponAccessoryParser } from "./parsers/items/gear-weapon-accessory-parser.js";
import { GearVehicleItemParser } from "./parsers/items/gear-vehicle-item-parser.js";
import { GearElectronicsCommlinkParser } from "./parsers/items/gear-electronics-commlink-parser.js";
import { GearElectronicsCyberdeckParser } from "./parsers/items/gear-electronics-cyberdeck-parser.js";
import { GearCyberwareHeadwareParser } from "./parsers/items/cyberware/gear-cyberware-headware-parser.js";
import { GearCyberwareEyewareParser } from "./parsers/items/cyberware/gear-cyberware-eyeware-parser.js";
import { GearCyberwareEarwareParser } from "./parsers/items/cyberware/gear-cyberware-earware-parser.js";
import { GearCyberwareBodywareParser } from "./parsers/items/cyberware/gear-cyberware-bodyware-parser.js";
import { GearCyberwareCulturedBiowareParser } from "./parsers/items/cyberware/gear-cyberware-cultured-bioware-parser.js";
import { GearCyberwareCyberjackParser } from "./parsers/items/cyberware/gear-cyberware-cyberjack-parser.js";
import { GearCyberwareCyberlimbParser } from "./parsers/items/cyberware/gear-cyberware-cyberlimb-parser.js";
import { GearCyberwareCyberlimbAccessoryParser } from "./parsers/items/cyberware/gear-cyberware-cyberlimb-accessory-parser.js";
import { CritterPowerItemParser } from "./parsers/items/critter-power-item-parser.js";

export class ShadowrunItemsImporterParser {

  isFocusInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toLowerCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType === "focus"
      || /\bTYPE\b\s+BONDING\s+COST\s*\(IN\s+KARMA\)\s+AVAILABILITY\s+COST\b/u.test(normalizedText);
  }
  isCritterPowerInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toLowerCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType === "critterpower"
      || /\bTYPE\b\s+ACTION\s+RANGE\s+DURATION\b/u.test(normalizedText);
  }

  isCyberwareCyberjackInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType.includes("CYBERJACK")
      || normalizedType.includes("CYBER_JACK")
      || /\bCYBERJACKS?\b\s+ATTRIBUTES\s*\(D\/F\)\s+MATRIX\s+INIT\s+BONUS\s+AVAIL\s+ESS\s+COST/u.test(normalizedText);
  }


  isElectronicsCommlinkInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType === "GEAR.ELECTRONICS.COMMLINK"
      || normalizedType === "GEAR.CYBERWARE.COMMLINK"
      || /\bCOMMLINKS?\b[\s\S]*?\bITEM\b[\s\S]*?\bDEVICE\s+RATING\b[\s\S]*?\bATTRIBUTES\s*\(D\s*\/\s*F\)[\s\S]*?\bACTIVE\s+PROGRAM\s+SLOTS\b[\s\S]*?\bAVAIL\b[\s\S]*?\bCOST\b/u.test(normalizedText)
      || /\bITEM\b[\s\S]*?\bDEVICE\s+RATING\b[\s\S]*?\bATTRIBUTES\s*\(D\s*\/\s*F\)[\s\S]*?\bACTIVE\s+PROGRAM\s+SLOTS\b[\s\S]*?\bAVAIL\b[\s\S]*?\bCOST\b/u.test(normalizedText);
  }

  isElectronicsCyberdeckInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType === "GEAR.ELECTRONICS.CYBERDECK"
      || normalizedType === "GEAR.CYBERWARE.CYBERDECK"
      || /\bCYBERDECKS?\b[\s\S]*?\bITEM\b[\s\S]*?\bDEVICE\s+RATING\b[\s\S]*?\bATTRIBUTES\s*\(A\s*\/\s*S\)[\s\S]*?\bACTIVE\s+PROGRAM\s+SLOTS\b[\s\S]*?\bAVAIL\b[\s\S]*?\bCOST\b/u.test(normalizedText)
      || /\bITEM\b[\s\S]*?\bDEVICE\s+RATING\b[\s\S]*?\bATTRIBUTES\s*\(A\s*\/\s*S\)[\s\S]*?\bACTIVE\s+PROGRAM\s+SLOTS\b[\s\S]*?\bAVAIL\b[\s\S]*?\bCOST\b/u.test(normalizedText);
  }

  isCyberwareHeadwareInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "");

    return normalizedType.includes("CYBER_HEADWARE")
      || /^HEADWARE\s+ESSENCE\s+CAPACITY\s+AVAIL\s+COST\b/mi.test(normalizedText);
  }

  isCyberwareEyewareInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "");

    return normalizedType.includes("CYBER_EYEWARE")
      || /^EYEWARE\s+ESSENCE\s+CAPACITY\s+AVAIL\s+COST\b/mi.test(normalizedText);
  }

  isCyberwareEarwareInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "");

    return normalizedType.includes("CYBER_EARWARE")
      || /^EARWARE\s+ESSENCE\s+CAPACITY\s+AVAIL\s+COST\b/mi.test(normalizedText);
  }

  isCyberwareCyberlimbAccessoryInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType.includes("CYBER_LIMB_ACCESSORY")
      || /\bACCESSORIES\b\s+CAPACITY\s+AVAIL\s+COST\b/u.test(normalizedText);
  }


  isCyberwareCyberlimbInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType.includes("CYBER_LIMBS")
      || normalizedType.includes("CYBER_LIMB")
      || /\bLIMB\b\s+ESSENCE\s+AVAIL\s+SYNTHETIC\s+COST\s*\(CAPACITY\)\s+OBVIOUS\s+COST\s*\(CAPACITY\)/u.test(normalizedText);
  }

  isCyberwareBodywareInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "");

    return normalizedType.includes("CYBER_BODYWARE")
      || normalizedType.includes("BIOWARE_STANDARD")
      || /^BODYWARE\s+ESSENCE\s+CAPACITY\s+AVAIL\s+COST\b/mi.test(normalizedText)
      || /^BODYWARE\s+RATING\s+ESSENCE\s+AVAILABILITY\s+COST\b/mi.test(normalizedText);
  }



  isCyberwareCulturedBiowareInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType.includes("BIOWARE_CULTURED")
      || normalizedType.includes("CULTURED_BIOWARE")
      || (
        /\bBODYWARE\b\s+RATING\s+ESSENCE\s+AVAILABILITY\s+COST\b/u.test(normalizedText)
        && /\b(?:CEREBRAL BOOSTER|DAMAGE COMPENSATOR|MNEMONIC ENHANCER|PAIN EDITOR|REFLEX RECORDER|SLEEP REGULATOR|SYNAPTIC BOOSTER)\b/u.test(normalizedText)
      );
  }

  isVehicleInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "");
    const categoryHeader = [
      "BIKES",
      "CARS",
      "TRUCKS\\s+AND\\s+VANS",
      "BOATS",
      "SUBMARINES",
      "FIXED\\s*[-–—]?\\s*WING\\s+AIRCRAFT",
      "ROTORCRAFT",
      "VTOL\\s*\\/\\s*VSTOL",
      "MICRODRONES",
      "MINIDRONES",
      "SMALL\\s+DRONES",
      "MEDIUM\\s+DRONES",
      "LARGE\\s+DRONES",
      "DRONES",
      "AIRCRAFT"
    ].join("|");
    const vehicleHeaderPattern = new RegExp(`^(?:${categoryHeader})\\b[\\s\\S]*?\\bHAND\\b[\\s\\S]*?\\bCOST\\b`, "mi");

    return normalizedType.includes("VEHICLES")
      || normalizedType.includes("DRONES")
      || vehicleHeaderPattern.test(normalizedText)
      || /^HAND\s+(?:ACC|ACCEL)\b[\s\S]*?\bCOST\b/mi.test(normalizedText);
  }

  isWeaponAccessoryInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "");

    return normalizedType.includes("ACCESSOR")
      || /^ACCESSORY\s+MOUNT\s+AVAILABILITY\s+COST\b/mi.test(normalizedText);
  }

  parseInput(rawText, folderId, itemType) {
    const normalizedItemType = String(itemType ?? "");

    if (!globalThis.ohm) {
      throw new Error("Ohm.js is required but was not found on globalThis.ohm");
    }

    let parser;
    console.log("Creating parser for type:", normalizedItemType, folderId, rawText);


    if (this.isFocusInput(normalizedItemType, rawText)) {
      parser = new FocusItemParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isCritterPowerInput(normalizedItemType, rawText)) {
      parser = new CritterPowerItemParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareCyberjackInput(normalizedItemType, rawText)) {
      parser = new GearCyberwareCyberjackParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isElectronicsCyberdeckInput(normalizedItemType, rawText)) {
      parser = new GearElectronicsCyberdeckParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isElectronicsCommlinkInput(normalizedItemType, rawText)) {
      parser = new GearElectronicsCommlinkParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareHeadwareInput(normalizedItemType, rawText)) {
      parser = new GearCyberwareHeadwareParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareEyewareInput(normalizedItemType, rawText)) {
      parser = new GearCyberwareEyewareParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareEarwareInput(normalizedItemType, rawText)) {
      parser = new GearCyberwareEarwareParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareCyberlimbAccessoryInput(normalizedItemType, rawText)) {
      parser = new GearCyberwareCyberlimbAccessoryParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }


    if (this.isCyberwareCyberlimbInput(normalizedItemType, rawText)) {
      parser = new GearCyberwareCyberlimbParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }


    if (this.isCyberwareCulturedBiowareInput(normalizedItemType, rawText)) {
      parser = new GearCyberwareCulturedBiowareParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareBodywareInput(normalizedItemType, rawText)) {
      parser = new GearCyberwareBodywareParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (this.isWeaponAccessoryInput(normalizedItemType, rawText)) {
      parser = new GearWeaponAccessoryParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }


    if (this.isVehicleInput(normalizedItemType, rawText)) {
      parser = new GearVehicleItemParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    if (normalizedItemType.startsWith("gear.WEAPON")) {
      parser = new GearWeaponParser({ text: rawText, type: normalizedItemType, folderId });
      return parser.parse();
    }

    switch (normalizedItemType) {
      case "quality":
        parser = new QualityItemParser({ text: rawText, type: normalizedItemType, folderId });
        break;
      case "metamagic":
        parser = new MetamagicItemParser({ text: rawText, type: normalizedItemType, folderId });
        break;
      case "critterpower":
        parser = new CritterPowerItemParser({ text: rawText, type: normalizedItemType, folderId });
        break;
      case "gear.CHEMICALS.TOXINS":
        parser = new GearChemicalsToxinsParser({ text: rawText, type: normalizedItemType, folderId });
        break;
      case "gear.ELECTRONICS.COMMLINK":
      case "gear.CYBERWARE.COMMLINK":
        parser = new GearElectronicsCommlinkParser({ text: rawText, type: normalizedItemType, folderId });
        break;
      case "gear.ELECTRONICS.CYBERDECK":
      case "gear.CYBERWARE.CYBERDECK":
        parser = new GearElectronicsCyberdeckParser({ text: rawText, type: normalizedItemType, folderId });
        break;

      case "gear.VEHICLES.BIKES":
      case "gear.VEHICLES.CARS":
      case "gear.VEHICLES.TRUCKS_AND_VANS":
      case "gear.VEHICLES.BOATS":
      case "gear.VEHICLES.DRONES":
      case "gear.VEHICLES.AIRCRAFT":
        parser = new GearVehicleItemParser({ text: rawText, type: normalizedItemType, folderId });
        break;
      case "spell":
        parser = new SpellItemParser({ text: rawText, type: normalizedItemType, folderId });
        break;
      case "focus":
        parser = new FocusItemParser({ text: rawText, type: normalizedItemType, folderId });
        break;
      default: {
        const translationKey = CONFIG.Item.typeLabels?.[normalizedItemType];
        const label = translationKey ? game.i18n.localize(translationKey) : (normalizedItemType || "Unknown type");
        ui.notifications?.warn(`${label} is not supported yet.`);
        return null;
      }
    }

    return parser.parse();
  }
}


