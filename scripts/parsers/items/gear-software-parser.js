import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

/**
 * Parser for the generic gear/software table from the Shadowrun 6 core book.
 *
 * It creates normal `gear` documents because the source table contains
 * availability and price data. Actual named Matrix programs (Baby Monitor,
 * Armor, Exploit, and so on) remain handled by GearSoftwareProgramParser.
 */
export class GearSoftwareParser extends BaseItemParser {
  static GEAR_TYPE = "SOFTWARE";

  static TABLE_HEADER = /^SOFTWARE\s+AVAIL(?:ABILITY)?\s+COST$/iu;

  static SUBTYPE_BY_NAME = Object.freeze({
    autosoft: "AUTOSOFT",
    "cyberprogram basic": "BASIC_PROGRAM",
    "cyberprogram hacking": "HACKING_PROGRAM",
    activesoft: "SKILLSOFT",
    activesofts: "SKILLSOFT",
    knowsoft: "SKILLSOFT",
    knowsofts: "SKILLSOFT",
    linguasoft: "SKILLSOFT",
    linguasofts: "SKILLSOFT",
    skillsoft: "SKILLSOFT",
    skillsofts: "SKILLSOFT",
    datasoft: "OTHER_PROGRAMS",
    datasofts: "OTHER_PROGRAMS",
    mapsoft: "OTHER_PROGRAMS",
    mapsofts: "OTHER_PROGRAMS",
    shopsoft: "OTHER_PROGRAMS",
    shopsofts: "OTHER_PROGRAMS",
    tutorsoft: "OTHER_PROGRAMS",
    tutorsofts: "OTHER_PROGRAMS"
  });

  static DESCRIPTION_HEADING_ALIASES = Object.freeze({
    autosoft: "autosoft",
    autosofts: "autosoft",
    program: "programs",
    programs: "programs",
    datasoft: "datasoft",
    datasofts: "datasoft",
    mapsoft: "mapsoft",
    mapsofts: "mapsoft",
    shopsoft: "shopsoft",
    shopsofts: "shopsoft",
    skillsoft: "skillsoft",
    skillsofts: "skillsoft",
    activesoft: "activesoft",
    activesofts: "activesoft",
    knowsoft: "knowsoft",
    knowsofts: "knowsoft",
    linguasoft: "linguasoft",
    linguasofts: "linguasoft",
    tutorsoft: "tutorsoft",
    tutorsofts: "tutorsoft"
  });

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    const headerIndex = lines.findIndex((line) => GearSoftwareParser.TABLE_HEADER.test(this.normalizeLine(line)));

    if (headerIndex < 0) {
      ui.notifications?.warn('No software table header found for "SOFTWARE AVAIL COST".');
      return [];
    }

    const { rows, nextIndex } = this.parseTableRows(lines, headerIndex + 1);
    const descriptions = this.parseDescriptionSections(lines.slice(nextIndex));
    const warnings = [];
    const items = [];

    for (const row of rows) {
      // "Skillsofts" is a grouping row in the printed table. The actual
      // purchasable entries are Activesofts, Knowsofts, and Linguasofts.
      if (this.isSkillsoftGroupRow(row)) continue;

      const description = this.descriptionForRow(row, descriptions);
      const ratingRange = this.resolveRatingRange(row, description);

      if (this.hasRatingFormula(row) && !ratingRange) {
        warnings.push(`Rating-based software values found for "${row.name}", but no rating range was found in the table or description.`);
      }

      items.push(...this.expandRow({ row, description, ratingRange, warnings }));
    }

    if (!rows.length) {
      ui.notifications?.warn("No software rows were recognized below the table header.");
    }

    return items;
  }

  parseTableRows(lines, startIndex) {
    const rows = [];
    let index = startIndex;

    for (; index < lines.length; index += 1) {
      const line = this.normalizeLine(lines[index]);
      if (!line) continue;
      if (this.isSeparatorLine(line)) break;

      const row = this.parseTableRow(line);
      if (!row) break;
      rows.push(row);
    }

    return { rows, nextIndex: index };
  }

  parseTableRow(line) {
    const normalized = this.normalizeLine(line);
    if (!normalized || GearSoftwareParser.TABLE_HEADER.test(normalized)) return null;

    // Parse from the right because names may contain commas and rating text.
    // Cost is either a numeric amount, a Rating formula, an em dash, or the
    // anomalous non-purchasable Skillsofts group marker from the printed table.
    const match = normalized.match(
      /^(.+?)\s+((?:Rating\s*\(\s*\d+\s*[–—-]\s*\d+\s*\)|Rating\s*\/\s*\d+|\d+(?:\s*\([A-Z]\))?|[–—-]))\s+((?:Rating\s*[x×]\s*\d[\d,._\s]*|\+?\d[\d,._\s]*)\s*¥?|[–—-])$/iu
    );

    if (!match) return null;

    const name = String(match[1] ?? "").trim();
    const availability = String(match[2] ?? "").trim();
    const cost = String(match[3] ?? "").trim();
    if (!name) return null;

    return {
      raw: normalized,
      name,
      cleanName: this.cleanRatingSuffix(name),
      normalizedName: this.normalizeComparableName(this.cleanRatingSuffix(name)),
      availability,
      cost
    };
  }

  parseDescriptionSections(lines = []) {
    const sections = new Map();
    let currentKey = "";

    const append = (key, text) => {
      const clean = String(text ?? "").trim();
      if (!key || !clean) return;
      const values = sections.get(key) ?? [];
      values.push(clean);
      sections.set(key, values);
    };

    for (const rawLine of lines) {
      const line = this.normalizeLine(rawLine);
      if (!line || this.isSeparatorLine(line) || this.isPageNoiseLine(line)) continue;

      const headingKey = this.resolveDescriptionHeading(line);
      if (headingKey) {
        currentKey = headingKey;
        if (!sections.has(currentKey)) sections.set(currentKey, []);
        continue;
      }

      // PDF extraction can append the next column heading to the end of the
      // previous sentence, for example "... see p. 201. Programs".
      const embedded = this.splitTrailingDescriptionHeading(line);
      if (embedded) {
        append(currentKey, embedded.text);
        currentKey = embedded.key;
        if (!sections.has(currentKey)) sections.set(currentKey, []);
        continue;
      }

      append(currentKey, line);
    }

    return sections;
  }

  resolveDescriptionHeading(line) {
    const normalized = this.normalizeComparableName(line);
    return GearSoftwareParser.DESCRIPTION_HEADING_ALIASES[normalized] ?? "";
  }

  splitTrailingDescriptionHeading(line) {
    for (const heading of Object.keys(GearSoftwareParser.DESCRIPTION_HEADING_ALIASES)) {
      const label = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = String(line ?? "").match(new RegExp(`^(.*[.!?])\\s+(${label})$`, "iu"));
      if (!match) continue;

      return {
        text: match[1].trim(),
        key: GearSoftwareParser.DESCRIPTION_HEADING_ALIASES[heading]
      };
    }

    return null;
  }

  descriptionForRow(row, sections) {
    const key = row.normalizedName;
    const parts = [];

    if (key === "cyberprogram basic" || key === "cyberprogram hacking") {
      parts.push(...(sections.get("programs") ?? []));
    } else if (["activesofts", "activesoft", "knowsofts", "knowsoft", "linguasofts", "linguasoft"].includes(key)) {
      parts.push(...(sections.get("skillsoft") ?? []));
      parts.push(...(sections.get(key.replace(/s$/u, "")) ?? []));
    } else {
      parts.push(...(sections.get(key.replace(/s$/u, "")) ?? []));
    }

    const text = this.joinWrappedText(parts);
    return text ? `<p>${this.escapeHtml(text)}</p>` : "";
  }

  resolveRatingRange(row, descriptionHtml = "") {
    const description = this.stripHtml(descriptionHtml);

    // A specific statement that the item has no rating overrides a shared
    // parent description such as "All skillsofts are available in ratings...".
    if (/\b(?:do|does)\s+not\s+have\s+(?:a\s+)?ratings?\b/iu.test(description)) return null;

    for (const source of [row.name, row.availability]) {
      const range = this.extractRatingRange(source);
      if (range) return range;
    }

    // A specific maximum in the item description (for example Linguasofts)
    // must override the broader shared Skillsoft range.
    const maximum = description.match(/\b(?:cannot|can(?:not|'t))\s+go\s+above\s+rating\s+(\d+)\b/iu);
    if (maximum) return { min: 1, max: Number(maximum[1]) };

    return this.extractRatingRange(description);
  }

  extractRatingRange(value) {
    const source = String(value ?? "");
    const patterns = [
      /\bratings?\s*\(\s*(\d+)\s*[–—-]\s*(\d+)\s*\)/iu,
      /\bratings?\s+(\d+)\s*[–—-]\s*(\d+)\b/iu,
      /\bratings?\s+from\s+(\d+)\s+to\s+(\d+)\b/iu,
      /\bavailable\s+in\s+ratings?\s+from\s+(\d+)\s+to\s+(\d+)\b/iu
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;

      const min = Number(match[1]);
      const max = Number(match[2]);
      if (Number.isInteger(min) && Number.isInteger(max) && min > 0 && min <= max) {
        return { min, max };
      }
    }

    return null;
  }

  expandRow({ row, description = "", ratingRange = null, warnings = [] } = {}) {
    const baseName = row?.cleanName || row?.name || "Unnamed Software";

    if (!ratingRange) {
      return [this.toFoundryItem({
        name: baseName,
        description,
        row,
        rating: 0,
        needsRating: false,
        warnings
      })];
    }

    const items = [];
    for (let rating = ratingRange.min; rating <= ratingRange.max; rating += 1) {
      items.push(this.toFoundryItem({
        name: `${baseName} (Rating ${rating})`,
        description,
        row,
        rating,
        needsRating: true,
        warnings
      }));
    }

    return items;
  }

  toFoundryItem({ name, description = "", row = null, rating = 0, needsRating = false, warnings = [] } = {}) {
    const availability = this.resolveAvailability(row?.availability, rating);
    const cost = this.resolveCost(row?.cost, rating);
    const subtype = this.resolveSubtype(row?.cleanName || row?.name);

    return {
      name: name || "Unnamed Software",
      type: "gear",
      img: "systems/shadowrun6-eden/icons/compendium/default/Default_Program.svg",
      system: {
        genesisID: "",
        description: description ?? "",
        product: "",
        page: 0,
        modifier: 0,
        wild: false,
        pool: 0,
        type: GearSoftwareParser.GEAR_TYPE,
        subtype,
        count: 0,
        countable: false,
        availDef: availability.availDef,
        avail: availability.avail,
        ammocap: 0,
        ammocount: 0,
        ammoLoaded: "regular",
        priceDef: cost.priceDef,
        price: cost.price,
        customName: "",
        usedForPool: false,
        notes: "",
        accessories: "",
        needsRating,
        rating,
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
          tableRow: row,
          ratingFormula: needsRating ? {
            availability: row?.availability ?? "",
            cost: row?.cost ?? ""
          } : null,
          warnings
        }
      }
    };
  }

  resolveSubtype(name) {
    const normalized = this.normalizeComparableName(this.cleanRatingSuffix(name));
    const preferred = GearSoftwareParser.SUBTYPE_BY_NAME[normalized] ?? this.subtypeFromParserType() ?? "OTHER_PROGRAMS";
    const configured = CONFIG?.SR6?.GEAR_SUBTYPES?.SOFTWARE ?? {};

    if (Object.hasOwn(configured, preferred)) return preferred;
    if (Object.hasOwn(configured, "OTHER_PROGRAMS")) return "OTHER_PROGRAMS";
    return preferred;
  }

  subtypeFromParserType() {
    const subtype = String(this.type ?? "").split(".").at(-1) || "";
    return Object.hasOwn(CONFIG?.SR6?.GEAR_SUBTYPES?.SOFTWARE ?? {}, subtype) ? subtype : "";
  }

  resolveAvailability(rawValue, rating = 0) {
    const raw = String(rawValue ?? "").trim();
    if (!raw || /^[–—-]$/u.test(raw)) return { availDef: "", avail: 0 };

    if (rating > 0 && /rating/iu.test(raw)) {
      const divisor = raw.match(/rating\s*\/\s*(\d+)/iu);
      const value = divisor ? Math.ceil(rating / Number(divisor[1])) : rating;
      return { availDef: String(value), avail: value };
    }

    const match = raw.match(/^(\d+)\s*(?:\(([A-Z])\)|([A-Z]))?$/iu);
    if (!match) return { availDef: raw, avail: this.extractFirstInteger(raw, 0) };

    const suffix = (match[2] ?? match[3] ?? "").toUpperCase();
    return {
      availDef: `${match[1]}${suffix}`,
      avail: Number(match[1])
    };
  }

  resolveCost(rawValue, rating = 0) {
    const raw = String(rawValue ?? "").trim();
    if (!raw || /^[–—-]$/u.test(raw)) return { priceDef: 0, price: 0 };

    const linear = raw.match(/rating\s*[x×]\s*(\d[\d,._\s]*)/iu);
    if (linear && rating > 0) {
      const multiplier = this.parseNumber(linear[1]);
      const value = rating * multiplier;
      return { priceDef: value, price: value };
    }

    const value = this.parseNumber(raw);
    return {
      priceDef: Number.isFinite(value) ? value : raw,
      price: Number.isFinite(value) ? value : 0
    };
  }

  parseNumber(value) {
    const match = String(value ?? "").match(/\d[\d,._\s]*/u);
    if (!match) return Number.NaN;
    return Number(match[0].replace(/[,._\s]/gu, ""));
  }

  hasRatingFormula(row) {
    return /rating/iu.test(`${row?.availability ?? ""} ${row?.cost ?? ""}`);
  }

  isSkillsoftGroupRow(row) {
    return row?.normalizedName === "skillsofts" || row?.normalizedName === "skillsoft";
  }

  cleanRatingSuffix(name) {
    return String(name ?? "")
      .replace(/\s*\(\s*rating\s+\d+\s*[–—-]\s*\d+\s*\)\s*$/iu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  normalizeComparableName(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[’']/gu, "")
      .replace(/[^a-z0-9]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  normalizeLine(value) {
    return String(value ?? "")
      .replace(/\u00A0/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  isSeparatorLine(line) {
    return /^-{3,}\s*$/u.test(String(line ?? "").trim());
  }

  isPageNoiseLine(line) {
    const normalized = this.normalizeLine(line).toUpperCase();
    return /^\d+\s*SHADOWRUN:/u.test(normalized)
      || /^SHADOWRUN:\s*SIXTH\s+WORLD$/u.test(normalized)
      || /^GEAR\s*\/\//u.test(normalized)
      || /^\/\/\s*GEAR$/u.test(normalized);
  }

  joinWrappedText(lines = []) {
    return lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  stripHtml(value) {
    return String(value ?? "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
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
