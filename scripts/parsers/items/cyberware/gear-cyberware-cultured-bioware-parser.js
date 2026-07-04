import { GearCyberwareBodywareParser } from "./gear-cyberware-bodyware-parser.js";

/**
 * Parser for SR6 cultured bioware tables.
 *
 * The printed table shape is intentionally the same as the bodyware/standard
 * bioware table:
 *
 *   BODYWARE RATING ESSENCE AVAILABILITY COST
 *   Cerebral booster 1–3 Rating x 0.2 5 Rating x 31,500¥
 *
 * Cultured bioware still needs implant grades, but it must not inherit the
 * Bone Density active-effect exception from standard bodyware. Keeping this as
 * a small subclass makes the shared table parsing logic stay in one place while
 * preserving the Eden subtype difference.
 */
export class GearCyberwareCulturedBiowareParser extends GearCyberwareBodywareParser {
  static ITEM_TYPE = "gear.BIOWARE.BIOWARE_CULTURED";

  getCyberwareSubtype() {
    return "BIOWARE_CULTURED";
  }

  getGearType() {
    return "BIOWARE";
  }

  buildBoneDensityActiveEffect(_itemName, _row, _rating) {
    return null;
  }
}
