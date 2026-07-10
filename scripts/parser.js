import { SII } from "./constants.js";
import { ShadowrunItemsImporterUtils as Utils } from "./utils.js";
import { QualityItemParser } from "./parsers/items/quality-item-parser.js";
import { MetamagicItemParser } from "./parsers/items/metamagic-item-parser.js";
import { GearChemicalsToxinsParser } from "./parsers/items/gear-chemicals-toxins-parser.js";
import { SpellItemParser } from "./parsers/items/spell-item-parser.js";
import { FocusItemParser } from "./parsers/items/focus-item-parser.js";
import { GearWeaponParser } from "./parsers/items/gear-weapon-parser.js";
import { GearWeaponAccessoryParser } from "./parsers/items/gear-weapon-accessory-parser.js";
import { GearVisualEnhancementParser } from "./parsers/items/gear-visual-enhancement-parser.js";
import { GearAudioEnhancementParser } from "./parsers/items/gear-audio-enhancement-parser.js";
import { GearVehicleItemParser } from "./parsers/items/gear-vehicle-item-parser.js";
import { GearElectronicsCyberdeckParser } from "./parsers/items/gear-electronics-cyberdeck-parser.js";
import { GearElectronicsCommlinkParser } from "./parsers/items/gear-electronics-commlink-parser.js";
import { GearElectronicOpticalParser } from "./parsers/items/gear-electronic-optical-parser.js";
import { GearElectronicAuditoryParser } from "./parsers/items/gear-electronic-auditory-parser.js";
import { GearSoftwareProgramParser } from "./parsers/items/gear-software-program-parser.js";
import { GearSoftwareParser } from "./parsers/items/gear-software-parser.js";
import { SinItemParser } from "./parsers/items/sin-item-parser.js";
import { GearArmorParser } from "./parsers/items/gear-armor-parser.js";
import { GearCyberwareHeadwareParser } from "./parsers/items/cyberware/gear-cyberware-headware-parser.js";
import { GearCyberwareEyewareParser } from "./parsers/items/cyberware/gear-cyberware-eyeware-parser.js";
import { GearCyberwareEarwareParser } from "./parsers/items/cyberware/gear-cyberware-earware-parser.js";
import { GearCyberwareBodywareParser } from "./parsers/items/cyberware/gear-cyberware-bodyware-parser.js";
import { GearCyberwareCulturedBiowareParser } from "./parsers/items/cyberware/gear-cyberware-cultured-bioware-parser.js";
import { GearCyberwareCyberjackParser } from "./parsers/items/cyberware/gear-cyberware-cyberjack-parser.js";
import { GearCyberwareCyberlimbParser } from "./parsers/items/cyberware/gear-cyberware-cyberlimb-parser.js";
import { GearCyberwareCyberlimbAccessoryParser } from "./parsers/items/cyberware/gear-cyberware-cyberlimb-accessory-parser.js";
import { CritterPowerItemParser } from "./parsers/items/critter-power-item-parser.js";
import { NpcStatblockParser } from "./parsers/actors/npc-statblock-parser.js";
import { CritterStatblockParser } from "./parsers/actors/critter-statblock-parser.js";
import { SpiritStatblockParser } from "./parsers/actors/spirit-statblock-parser.js";

export class ShadowrunItemsImporterParser {

  isSpiritActorInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").replace(/\r\n?/g, "\n");

    return normalizedType.startsWith("ACTOR.SPIRIT")
      || normalizedType === "SPIRIT"
      || (/^\s*SPIRITS?\s+OF\s+/imu.test(normalizedText)
        && /(?:^|\n)\s*AC\s+CM\s+MOVE\s*(?:\n|$)/iu.test(normalizedText)
        && /(?:^|\n)\s*Optional\s+Powers\s*:/iu.test(normalizedText));
  }

  isCritterActorInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").replace(/\r\n?/g, "\n");

    return normalizedType === "ACTOR.CRITTER"
      || normalizedType === "CRITTER"
      || (/^(?:dog|basilisk|[A-Za-z][A-Za-z\s'’\/-]{1,80})\s*$/imu.test(normalizedText)
        && /(?:^|\n)\s*I\/ID\s+AC\s+CM\s+MOVE\s*(?:\n|$)/iu.test(normalizedText)
        && /(?:^|\n)\s*(?:Powers|Attack|Defense\s+Rating)\s*:/iu.test(normalizedText));
  }

  isNpcActorInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").replace(/\r\n?/g, "\n");

    return normalizedType === "ACTOR.NPC"
      || normalizedType === "NPC"
      || /(?:^|\n)\s*B\s+A\s+R\s+S\s+W\s+L\s+I\s+C(?:\s+M)?\s+ESS\s*(?:\n|$)/iu.test(normalizedText);
  }

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

  isElectronicsCyberdeckInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType.includes("CYBERDECK")
      || /\bCYBERDECKS?\b[\s\S]*?\bITEM\b[\s\S]*?\bDEVICE\s+RATING\b[\s\S]*?\bATTRIBUTES\s*\(\s*A\s*\/\s*S\s*\)[\s\S]*?\bACTIVE\s+PROGRAM\s+SLOTS\b[\s\S]*?\bAVAIL\b[\s\S]*?\bCOST\b/u.test(normalizedText);
  }

  isElectronicsCommlinkInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType.includes("COMMLINK")
      || /\bCOMMLINKS?\b[\s\S]*?\bITEM\b[\s\S]*?\bDEVICE\s+RATING\b[\s\S]*?\bATTRIBUTES\s*\(\s*D\s*\/\s*F\s*\)[\s\S]*?\bACTIVE\s+PROGRAM\s+SLOTS\b[\s\S]*?\bAVAIL\b[\s\S]*?\bCOST\b/u.test(normalizedText);
  }

  isElectronicsOpticalInput(itemType) {
    return String(itemType ?? "").trim().toUpperCase() === "GEAR.ELECTRONICS.OPTICAL";
  }

  isElectronicsAuditoryInput(itemType) {
    return String(itemType ?? "").trim().toUpperCase() === "GEAR.ELECTRONICS.AUDIO";
  }


  isArmorInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").toUpperCase().replace(/\s+/g, " ");

    return normalizedType.startsWith("GEAR.ARMOR")
      || /\bTYPE\b\s+DEFENSE\s+RATING\s+CAPACITY\s+AVAIL(?:ABILITY)?\s+COST\b/u.test(normalizedText);
  }

  isSinInput(itemType) {
    return String(itemType ?? "").trim().toLowerCase() === "sin";
  }

  isSoftwareTableInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").replace(/\r\n?/g, "\n");

    return /^\s*SOFTWARE\s+AVAIL(?:ABILITY)?\s+COST\s*$/imu.test(normalizedText)
      || (normalizedType.startsWith("GEAR.SOFTWARE")
        && /^\s*SOFTWARE\s+AVAIL(?:ABILITY)?\s+COST\s*$/imu.test(normalizedText));
  }

  isSoftwareProgramInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").toUpperCase();
    const normalizedText = String(rawText ?? "").replace(/\r\n?/g, "\n");
    const flattenedText = normalizedText.toUpperCase().replace(/\s+/g, " ");

    if (normalizedType === "SOFTWARE") return true;
    if (/^GEAR\.SOFTWARE\.(?:BASIC_PROGRAM|HACKING_PROGRAM|RIGGER_PROGRAM|OTHER_PROGRAMS)$/u.test(normalizedType)) return true;

    const hasProgramCategory = /^\s*(?:BASIC|HACKING|RIGGER|OTHER(?:\s+PROGRAMS?)?)\s*$/gmi.test(normalizedText);
    const hasBulletProgram = /^[\s•*\-]*[^:\n]{1,100}:\s*\S+/gmu.test(normalizedText);
    const mentionsKnownProgram = /\b(?:BABY\s+MONITOR|BROWSE|CONFIGURATOR|ENCRYPTION|SIGNAL\s+SCRUBBER|VIRTUAL\s+MACHINE|BIOFEEDBACK|BLACKOUT|DECRYPTION|EXPLOIT|LOCKDOWN|OVERCLOCK|TRACE)\b/u.test(flattenedText);

    return hasProgramCategory && hasBulletProgram && mentionsKnownProgram;
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

  isAudioEnhancementInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").trim().toLowerCase();
    const normalizedText = String(rawText ?? "");
    const hasEnhancementHeader = /^ENHANCEMENT\s+CAPACITY\s+AVAIL(?:ABILITY)?\s+COST\b/mi.test(normalizedText);

    if (normalizedType === "mod.audio_enhancement" || normalizedType === "audio_enhancement") return true;
    if (normalizedType.startsWith("mod.")) return false;

    return normalizedType === "mod"
      && hasEnhancementHeader
      && /(?:^|\n)\s*(?:Audio enhancement|Select sound filter|Spatial recognizer)\b/mi.test(normalizedText);
  }

  isVisualEnhancementInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").trim().toLowerCase();
    const normalizedText = String(rawText ?? "");
    const hasEnhancementHeader = /^ENHANCEMENT\s+CAPACITY\s+AVAIL(?:ABILITY)?\s+COST\b/mi.test(normalizedText);

    if (normalizedType === "mod.visual_enhancement" || normalizedType === "visual_enhancement") return true;
    if (normalizedType.startsWith("mod.")) return false;

    return normalizedType === "mod"
      && hasEnhancementHeader
      && /(?:^|\n)\s*(?:Flare compensation|Image link|Low-light vision|Smartlink|Thermographic vision|Ultrasound link|Vision enhancement|Vision magnification)\b/mi.test(normalizedText);
  }

  isWeaponAccessoryInput(itemType, rawText) {
    const normalizedType = String(itemType ?? "").trim().toLowerCase();
    const normalizedText = String(rawText ?? "");

    if (["mod.accessory_weapon", "accessory_weapon", "gear.accessory.accessory"].includes(normalizedType)) {
      return true;
    }
    if (normalizedType.startsWith("mod.")) return false;

    return /^ACCESSORY\s+MOUNT\s+AVAILABILITY\s+COST\b/mi.test(normalizedText);
  }

  parseInput(rawText, folderId, itemType) {
    if (!globalThis.ohm) {
      throw new Error("Ohm.js is required but was not found on globalThis.ohm");
    }

    let parser;
    console.log("Creating parser for type:", itemType, folderId, rawText);


    if (this.isSpiritActorInput(itemType, rawText)) {
      parser = new SpiritStatblockParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isCritterActorInput(itemType, rawText)) {
      parser = new CritterStatblockParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isNpcActorInput(itemType, rawText)) {
      parser = new NpcStatblockParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isSinInput(itemType)) {
      parser = new SinItemParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isFocusInput(itemType, rawText)) {
      parser = new FocusItemParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isCritterPowerInput(itemType, rawText)) {
      parser = new CritterPowerItemParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareCyberjackInput(itemType, rawText)) {
      parser = new GearCyberwareCyberjackParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareHeadwareInput(itemType, rawText)) {
      parser = new GearCyberwareHeadwareParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareEyewareInput(itemType, rawText)) {
      parser = new GearCyberwareEyewareParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareEarwareInput(itemType, rawText)) {
      parser = new GearCyberwareEarwareParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareCyberlimbAccessoryInput(itemType, rawText)) {
      parser = new GearCyberwareCyberlimbAccessoryParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }


    if (this.isCyberwareCyberlimbInput(itemType, rawText)) {
      parser = new GearCyberwareCyberlimbParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }


    if (this.isCyberwareCulturedBiowareInput(itemType, rawText)) {
      parser = new GearCyberwareCulturedBiowareParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isCyberwareBodywareInput(itemType, rawText)) {
      parser = new GearCyberwareBodywareParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isAudioEnhancementInput(itemType, rawText)) {
      parser = new GearAudioEnhancementParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isVisualEnhancementInput(itemType, rawText)) {
      parser = new GearVisualEnhancementParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isWeaponAccessoryInput(itemType, rawText)) {
      parser = new GearWeaponAccessoryParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }


    if (this.isElectronicsAuditoryInput(itemType)) {
      parser = new GearElectronicAuditoryParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isElectronicsOpticalInput(itemType)) {
      parser = new GearElectronicOpticalParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isElectronicsCyberdeckInput(itemType, rawText)) {
      parser = new GearElectronicsCyberdeckParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isElectronicsCommlinkInput(itemType, rawText)) {
      parser = new GearElectronicsCommlinkParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isSoftwareTableInput(itemType, rawText)) {
      parser = new GearSoftwareParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isSoftwareProgramInput(itemType, rawText)) {
      parser = new GearSoftwareProgramParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isArmorInput(itemType, rawText)) {
      parser = new GearArmorParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (this.isVehicleInput(itemType, rawText)) {
      parser = new GearVehicleItemParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    if (String(itemType ?? "").startsWith("gear.WEAPON")) {
      parser = new GearWeaponParser({ text: rawText, type: itemType, folderId });
      return parser.parse();
    }

    switch (itemType) {
      case "sin":
        parser = new SinItemParser({ text: rawText, type: itemType, folderId });
        break;
      case "quality":
        parser = new QualityItemParser({ text: rawText, type: itemType, folderId });
        break;
      case "metamagic":
        parser = new MetamagicItemParser({ text: rawText, type: itemType, folderId });
        break;
      case "critterpower":
        parser = new CritterPowerItemParser({ text: rawText, type: itemType, folderId });
        break;
      case "gear.CHEMICALS.TOXINS":
        parser = new GearChemicalsToxinsParser({ text: rawText, type: itemType, folderId });
        break;

      case "gear.ARMOR.ARMOR_BODY":
      case "gear.ARMOR.ARMOR_HELMET":
      case "gear.ARMOR.ARMOR_SHIELD":
      case "gear.ARMOR.ARMOR_SOCIAL":
      case "gear.ARMOR.ARMOR_CLOTHES":
        parser = new GearArmorParser({ text: rawText, type: itemType, folderId });
        break;

      case "gear.ELECTRONICS.CYBERDECK":
      case "gear.CYBERWARE.CYBERDECK":
        parser = new GearElectronicsCyberdeckParser({ text: rawText, type: itemType, folderId });
        break;
      case "gear.ELECTRONICS.COMMLINK":
      case "gear.CYBERWARE.COMMLINK":
        parser = new GearElectronicsCommlinkParser({ text: rawText, type: itemType, folderId });
        break;
      case "gear.ELECTRONICS.OPTICAL":
        parser = new GearElectronicOpticalParser({ text: rawText, type: itemType, folderId });
        break;
      case "gear.ELECTRONICS.AUDIO":
        parser = new GearElectronicAuditoryParser({ text: rawText, type: itemType, folderId });
        break;
      case "mod.accessory_weapon":
        parser = new GearWeaponAccessoryParser({ text: rawText, type: itemType, folderId });
        break;
      case "mod.visual_enhancement":
        parser = new GearVisualEnhancementParser({ text: rawText, type: itemType, folderId });
        break;
      case "mod.audio_enhancement":
        parser = new GearAudioEnhancementParser({ text: rawText, type: itemType, folderId });
        break;
      case "gear.SOFTWARE.BASIC_PROGRAM":
      case "gear.SOFTWARE.HACKING_PROGRAM":
      case "gear.SOFTWARE.RIGGER_PROGRAM":
      case "gear.SOFTWARE.OTHER_PROGRAMS":
      case "software":
        parser = new GearSoftwareProgramParser({ text: rawText, type: itemType, folderId });
        break;

      case "gear.VEHICLES.BIKES":
      case "gear.VEHICLES.CARS":
      case "gear.VEHICLES.TRUCKS_AND_VANS":
      case "gear.VEHICLES.BOATS":
      case "gear.VEHICLES.DRONES":
      case "gear.VEHICLES.AIRCRAFT":
        parser = new GearVehicleItemParser({ text: rawText, type: itemType, folderId });
        break;
      case "spell":
        parser = new SpellItemParser({ text: rawText, type: itemType, folderId });
        break;
      case "focus":
        parser = new FocusItemParser({ text: rawText, type: itemType, folderId });
        break;
      default: {
        const typeKey = String(itemType ?? "");
        const labelKey = CONFIG.Item?.typeLabels?.[typeKey];
        const label = labelKey ? game.i18n.localize(labelKey) : (typeKey || "Unknown type");
        ui.notifications?.warn(`${label} is not supported yet.`);
        return null;
      }
    }

    return parser.parse();
  }
}


