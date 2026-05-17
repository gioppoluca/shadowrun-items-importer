import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

export class SoftwareItemParser extends BaseItemParser {
  static ITEM_TYPE = "software";

  static SOFTWARE_TYPE_ALIASES = {
    autosoft: "AUTOSOFT",
    autosofts: "AUTOSOFT",
    basic: "BASIC",
    hacking: "HACKING"
  };

  static AUTOSOFT_SUBTYPE_ALIASES = {
    clearsight: "CLEARSIGHT",
    "electronic warfare": "ELECTRONIC_WARFARE",
    evasion: "EVASION",
    maneuvering: "MANEUVER",
    manoeuvring: "MANEUVER",
    maneuver: "MANEUVER",
    manoeuvre: "MANEUVER",
    stealth: "STEALTH",
    "[weapon] targeting": "TARGETING",
    "weapon targeting": "TARGETING",
    targeting: "TARGETING"
  };

  static KNOWN_SOFTWARE_CATEGORIES = new Set([
    "autosoft",
    "autosofts",
    "basic",
    "hacking"
  ]);

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const entries = this.parseSoftwareEntries(lines);
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

    return items;
  }

  parseSoftwareEntries(lines = []) {
    const entries = [];
    let currentCategory = null;
    let currentEntry = null;

    const flushEntry = () => {
      if (!currentEntry) return;
      currentEntry.description = this.joinWrappedText(currentEntry.descriptionLines);
      delete currentEntry.descriptionLines;
      entries.push(currentEntry);
      currentEntry = null;
    };

    for (const rawLine of lines) {
      const line = this.stripBulletMarker(rawLine);
      if (!line) continue;

      if (this.isCategoryLine(line)) {
        flushEntry();
        currentCategory = line;
        continue;
      }

      const itemStart = this.parseSoftwareItemStart(line);
      if (itemStart) {
        flushEntry();
        currentEntry = {
          category: currentCategory,
          name: itemStart.name,
          descriptionLines: itemStart.value ? [itemStart.value] : []
        };
        continue;
      }

      if (currentEntry) {
        currentEntry.descriptionLines.push(line);
      }
    }

    flushEntry();
    return entries;
  }

  isCategoryLine(line) {
    const normalized = this.normalizeSoftwareKey(line);
    if (SoftwareItemParser.KNOWN_SOFTWARE_CATEGORIES.has(normalized)) return true;

    return Boolean(this.findConfiguredSoftwareSubtypeKey(line));
  }

  parseSoftwareItemStart(line) {
    const field = this.parseFieldLine(line);
    if (!field) return null;

    const name = String(field.label ?? "").trim();
    if (!this.isValidSoftwareItemName(name)) return null;

    return {
      name,
      value: String(field.value ?? "").trim()
    };
  }

  isValidSoftwareItemName(name) {
    const cleanName = String(name ?? "").trim();
    if (!cleanName) return false;

    // Attribute: is metadata inside autosoft descriptions, not a new software item.
    if (this.normalizeSoftwareKey(cleanName) === "attribute") return false;

    // Wrapped descriptions can contain sentences followed by Attribute:, for example
    // "ECM. Attribute: Sensor". The field parser would otherwise see
    // "ECM. Attribute" as the label and incorrectly start a new item.
    if (/[.;]/u.test(cleanName)) return false;

    return true;
  }

  toFoundryItem(entry, warnings = []) {
    const type = this.resolveSoftwareType(entry.category);
    const subtype = this.resolveSoftwareSubtype(entry.name, type);
    const attribute = this.extractAttribute(entry.description);

    if (!type) {
      warnings.push(`Software category not recognized for "${entry.name}". Empty software type was used.`);
    }

    if (type === "AUTOSOFT" && subtype === "MANEUVER" && !this.findConfiguredAutosoftSubtypeKey(entry.name)) {
      warnings.push(`Autosoft subtype not recognized for "${entry.name}". MANEUVER was used as fallback.`);
    }

    return {
      name: entry.name || "Unnamed Software",
      type: "software",
      img: "systems/shadowrun6-eden/icons/compendium/default/Default_Program.svg",
      system: {
        genesisID: "",
        description: this.buildDescription(entry, attribute),
        product: "",
        page: 0,
        type: type ?? "",
        subtype: subtype ?? "",
        category: attribute ?? "",
        rating: 1
      },
      effects: [],
      folder: this.folderId ?? null,
      flags: {}
    };
  }

  buildDescription(entry, attribute) {
    const category = this.resolveSoftwareType(entry.category) ?? String(entry.category ?? "").trim();
    const lines = [];

    if (category) lines.push(`<p><strong>Category:</strong> ${this.escapeHtml(category)}</p>`);
    if (attribute) lines.push(`<p><strong>Attribute:</strong> ${this.escapeHtml(attribute)}</p>`);

    const body = this.escapeHtml(entry.description ?? "");
    if (body) lines.push(`<p>${body}</p>`);

    return lines.join("");
  }

  joinWrappedText(lines = []) {
    return lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  extractAttribute(description) {
    const match = String(description ?? "").match(/\bAttribute:\s*([^.;]+)(?:[.;]|$)/iu);
    return match?.[1]?.trim() || "";
  }

  resolveSoftwareType(category) {
    const normalized = this.normalizeSoftwareKey(category);
    if (!normalized) return null;

    const configured = this.findConfiguredSoftwareSubtypeKey(category);
    if (configured) return configured;

    return SoftwareItemParser.SOFTWARE_TYPE_ALIASES[normalized] ?? this.toConstantKey(category);
  }

  resolveSoftwareSubtype(name, type) {
    if (type !== "AUTOSOFT") return "";

    const configured = this.findConfiguredAutosoftSubtypeKey(name);
    if (configured) return configured;

    return "MANEUVER";
  }

  findConfiguredSoftwareSubtypeKey(label) {
    const softwareSubtypes = CONFIG?.SR6?.GEAR_SUBTYPES?.SOFTWARE ?? {};
    return this.findConfigKeyByLabel(label, softwareSubtypes);
  }

  findConfiguredAutosoftSubtypeKey(label) {
    const autosoftTypes = CONFIG?.SR6?.AUTOSOFT_TYPES ?? {};
    const direct = this.findConfigKeyByLabel(label, autosoftTypes);
    if (direct) return direct;

    const alias = SoftwareItemParser.AUTOSOFT_SUBTYPE_ALIASES[this.normalizeSoftwareKey(label)];
    if (alias && Object.hasOwn(autosoftTypes, alias)) return alias;

    return null;
  }

  findConfigKeyByLabel(label, configObject = {}) {
    const wanted = this.normalizeSoftwareKey(label);
    if (!wanted) return null;

    for (const [key, value] of Object.entries(configObject ?? {})) {
      const keyNorm = this.normalizeSoftwareKey(key);
      const valueNorm = this.normalizeSoftwareKey(game?.i18n?.localize?.(value) ?? value);

      if (keyNorm === wanted || valueNorm === wanted) return key;
    }

    return null;
  }

  normalizeSoftwareKey(value) {
    return String(value ?? "")
      .replace(/[“”]/g, '"')
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  toConstantKey(value) {
    return String(value ?? "")
      .replace(/\[[^\]]+\]/gu, "weapon")
      .replace(/[’']/gu, "")
      .replace(/[^a-zA-Z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .toUpperCase();
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
