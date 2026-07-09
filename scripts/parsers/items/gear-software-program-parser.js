import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

/**
 * Parser for Shadowrun 6 Eden Matrix programs listed as gear/software.
 *
 * Expected input shape:
 *   Basic
 *   • Baby Monitor: Tells you your current Overwatch Score without needing an action.
 *   • Browse: When doing Matrix searches, gain 1 Edge ...
 *   Hacking
 *   • Armor: +2 to Defense Rating.
 *
 * Each non-bullet category line selects the software subtype for the following
 * bullet rows. Each bullet line becomes one Foundry gear item with:
 *   system.type    = "SOFTWARE"
 *   system.subtype = "BASIC_PROGRAM" | "HACKING_PROGRAM" | ...
 */
export class GearSoftwareProgramParser extends BaseItemParser {
  static GEAR_TYPE = "SOFTWARE";

  static CATEGORY_ALIASES = new Map([
    ["basic", "BASIC_PROGRAM"],
    ["basic program", "BASIC_PROGRAM"],
    ["basic programs", "BASIC_PROGRAM"],
    ["standard", "BASIC_PROGRAM"],
    ["standard program", "BASIC_PROGRAM"],
    ["standard programs", "BASIC_PROGRAM"],

    ["hacking", "HACKING_PROGRAM"],
    ["hacking program", "HACKING_PROGRAM"],
    ["hacking programs", "HACKING_PROGRAM"],

    ["rigger", "RIGGER_PROGRAM"],
    ["rigger program", "RIGGER_PROGRAM"],
    ["rigger programs", "RIGGER_PROGRAM"],

    ["other", "OTHER_PROGRAMS"],
    ["other program", "OTHER_PROGRAMS"],
    ["other programs", "OTHER_PROGRAMS"]
  ]);

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const entries = this.parseProgramEntries(lines);
    const warnings = [];
    const items = entries.map((entry) => this.toFoundryItem(entry, warnings));

    if (warnings.length) {
      for (const item of items) {
        item.flags[SII.MODULE_ID] = {
          ...(item.flags[SII.MODULE_ID] ?? {}),
          warnings
        };
      }
    }

    return items.length === 1 ? items[0] : items;
  }

  parseProgramEntries(lines = []) {
    const entries = [];
    let currentSubtype = this.subtypeFromParserType();
    let currentCategoryLabel = this.categoryLabelFromSubtype(currentSubtype);
    let currentEntry = null;

    const flushEntry = () => {
      if (!currentEntry) return;
      currentEntry.description = this.joinWrappedText(currentEntry.descriptionLines);
      delete currentEntry.descriptionLines;
      entries.push(currentEntry);
      currentEntry = null;
    };

    for (const rawLine of lines) {
      const line = String(rawLine ?? "").trim();
      if (!line || this.isSeparatorLine(line) || this.isPageNoiseLine(line)) continue;

      const categorySubtype = this.resolveCategorySubtype(line);
      if (categorySubtype) {
        flushEntry();
        currentSubtype = categorySubtype;
        currentCategoryLabel = this.stripBulletMarker(line);
        continue;
      }

      const itemStart = this.parseProgramItemStart(line);
      if (itemStart) {
        flushEntry();
        currentEntry = {
          name: itemStart.name,
          subtype: currentSubtype || "OTHER_PROGRAMS",
          categoryLabel: currentCategoryLabel || this.categoryLabelFromSubtype(currentSubtype),
          descriptionLines: itemStart.value ? [itemStart.value] : []
        };
        continue;
      }

      if (currentEntry && this.shouldUseAsContinuation(line)) {
        currentEntry.descriptionLines.push(this.stripBulletMarker(line));
      }
    }

    flushEntry();
    return entries;
  }

  parseProgramItemStart(line) {
    const withoutBullet = this.stripBulletMarker(line);
    const match = withoutBullet.match(/^([^:]{1,100}):\s*(.*)$/u);
    if (!match) return null;

    const name = String(match[1] ?? "").trim();
    const value = String(match[2] ?? "").trim();
    if (!this.isValidProgramName(name)) return null;

    return { name, value };
  }

  isValidProgramName(name) {
    const cleanName = String(name ?? "").trim();
    if (!cleanName) return false;

    // Reject obvious wrapped prose accidentally containing a colon.
    if (/[.;]/u.test(cleanName)) return false;

    return true;
  }

  resolveCategorySubtype(line) {
    const normalized = this.normalizeProgramKey(this.stripBulletMarker(line));
    if (!normalized) return null;

    const alias = GearSoftwareProgramParser.CATEGORY_ALIASES.get(normalized);
    if (alias) return alias;

    const configured = this.findConfiguredSoftwareSubtypeKey(line);
    if (configured && this.isProgramSubtype(configured)) return configured;

    return null;
  }

  subtypeFromParserType() {
    const parts = String(this.type ?? "").split(".");
    const subtype = parts.at(-1) || "";
    return this.isProgramSubtype(subtype) ? subtype : "";
  }

  isProgramSubtype(subtype) {
    return ["BASIC_PROGRAM", "HACKING_PROGRAM", "RIGGER_PROGRAM", "OTHER_PROGRAMS"].includes(String(subtype ?? ""));
  }

  findConfiguredSoftwareSubtypeKey(label) {
    const softwareSubtypes = CONFIG?.SR6?.GEAR_SUBTYPES?.SOFTWARE ?? {};
    const wanted = this.normalizeProgramKey(label);
    if (!wanted) return null;

    for (const [key, value] of Object.entries(softwareSubtypes)) {
      const keyNorm = this.normalizeProgramKey(key);
      const valueNorm = this.normalizeProgramKey(game?.i18n?.localize?.(value) ?? value);

      if (keyNorm === wanted || valueNorm === wanted) return key;
    }

    return null;
  }

  shouldUseAsContinuation(line) {
    if (this.isPageNoiseLine(line)) return false;
    if (this.resolveCategorySubtype(line)) return false;
    if (this.parseProgramItemStart(line)) return false;
    if (this.looksLikeSectionHeading(line)) return false;
    return true;
  }

  looksLikeSectionHeading(line) {
    const clean = this.stripBulletMarker(line);
    if (!clean || /[.:;!?]/u.test(clean)) return false;
    const words = clean.split(/\s+/u).filter(Boolean);
    if (!words.length || words.length > 4) return false;

    return words.every((word) => /^[A-Z][A-Za-z/\-]*$/u.test(word));
  }

  isPageNoiseLine(line) {
    const clean = String(line ?? "").trim();
    const normalized = clean.toUpperCase().replace(/\s+/g, " ");

    return /^PROGRAMS$/iu.test(clean)
      || /^MATRIX\s*\/\/\s*PROGRAMS\b/u.test(normalized)
      || /^\d+\s*SHADOWRUN:/u.test(normalized)
      || /^SHADOWRUN:\s*SIXTH\s+WORLD$/u.test(normalized);
  }

  isSeparatorLine(line) {
    return /^-{3,}\s*$/u.test(String(line ?? "").trim());
  }

  toFoundryItem(entry, warnings = []) {
    const subtype = entry.subtype || "OTHER_PROGRAMS";

    if (!this.isProgramSubtype(subtype)) {
      warnings.push(`Software program subtype not recognized for "${entry.name}". OTHER_PROGRAMS was used.`);
    }

    return {
      name: entry.name || "Unnamed Program",
      type: "gear",
      img: "systems/shadowrun6-eden/icons/compendium/gear/tech_bag.svg",
      system: {
        genesisID: "",
        description: this.buildDescription(entry),
        product: "",
        page: 0,
        modifier: 0,
        wild: false,
        pool: 0,
        type: GearSoftwareProgramParser.GEAR_TYPE,
        subtype: this.isProgramSubtype(subtype) ? subtype : "OTHER_PROGRAMS",
        count: 0,
        countable: false,
        availDef: "",
        avail: 0,
        ammocap: 0,
        ammocount: 0,
        ammoLoaded: "regular",
        priceDef: 0,
        price: 0,
        customName: "",
        usedForPool: false,
        notes: "",
        accessories: "",
        needsRating: false,
        rating: 0,
        skill: "",
        skillSpec: "",
        dmg: 0,
        stun: false,
        dmgDef: "",
        attackRating: [0, 0, 0, 0, 0],
        modes: {
          BF: false,
          FA: false,
          SA: false,
          SS: false
        },
        defense: 0,
        social: 0,
        essence: 0,
        capacity: 0,
        natural: false,
        devRating: 0,
        a: 0,
        s: 0,
        d: 0,
        f: 0,
        progSlots: 0,
        handlOn: 0,
        handlOff: 0,
        accOn: 0,
        accOff: 0,
        spdiOn: 0,
        spdiOff: 0,
        tspd: 0,
        bod: 0,
        arm: 0,
        pil: 0,
        sen: 0,
        sea: 0,
        vtype: "",
        vehicle: {
          opMode: "manual"
        },
        strWeapon: false,
        dualHand: false
      },
      effects: [],
      folder: this.folderId ?? null,
      flags: {
        [SII.MODULE_ID]: {
          sourceParser: this.constructor.name,
          softwareCategory: entry.categoryLabel || this.categoryLabelFromSubtype(subtype),
          softwareSubtype: subtype,
          rawDescription: entry.description ?? ""
        }
      }
    };
  }

  buildDescription(entry) {
    const categoryLabel = entry.categoryLabel || this.categoryLabelFromSubtype(entry.subtype);
    const description = this.joinWrappedText([entry.description]);
    const lines = [];

    if (categoryLabel) lines.push(`<p><strong>Category:</strong> ${this.escapeHtml(categoryLabel)}</p>`);
    if (description) lines.push(`<p>${this.escapeHtml(description)}</p>`);

    return lines.join("");
  }

  categoryLabelFromSubtype(subtype) {
    switch (String(subtype ?? "")) {
      case "BASIC_PROGRAM": return "Basic";
      case "HACKING_PROGRAM": return "Hacking";
      case "RIGGER_PROGRAM": return "Rigger";
      case "OTHER_PROGRAMS": return "Other Programs";
      default: return "";
    }
  }

  joinWrappedText(lines = []) {
    return lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  normalizeProgramKey(value) {
    return String(value ?? "")
      .replace(/[“”]/g, '"')
      .replace(/[’‘]/g, "'")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }
}
