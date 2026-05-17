import { SII } from "../../constants.js";
import { BaseItemParser } from "./base-item-parser.js";

/**
 * Parser for Shadowrun 6 Eden Biology/Biotech gear tables.
 *
 * Expected source shape:
 *   GEAR AVAIL COST
 *   Biomonitor 2 300¥
 *   DocWagon contracts
 *   Basic 1 500¥/ month or 5,000¥/year
 *   ...
 *
 * followed by textual sections. The textual section names decide which table
 * rows are imported, exactly like the other table+text parsers in this module.
 */
export class BiotechItemParser extends BaseItemParser {
  static ITEM_TYPE = "gear.BIOLOGY";

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const headerIndex = lines.findIndex((line) => this.isBiotechHeader(line));
    if (headerIndex < 0) {
      return this.toFoundryItem({
        name: lines[0] || "Unnamed Biotech Gear",
        description: this.descriptionHtml(lines.slice(1)),
        row: null,
        warnings: ["No biotech table header found. Import created with description only."]
      });
    }

    const { tableLines, textStartIndex } = this.collectTableLines(lines, headerIndex + 1);
    const rows = this.parseBiotechRows(tableLines);
    const textLines = lines.slice(textStartIndex);
    const sections = this.parseDescriptionSections(textLines);
    const items = [];
    const warnings = [];

    if (sections.length) {
      for (const section of sections) {
        const matchingRows = this.findRowsForSection(section.name, rows);
        if (!matchingRows.length) {
          warnings.push(`Biotech table row not found for "${section.name}". No items were created for that entry.`);
          continue;
        }

        for (const row of matchingRows) {
          items.push(...this.expandRow({
            sectionName: section.name,
            descriptionLines: this.descriptionLinesForRow(section, row, rows),
            row,
            warnings: []
          }));
        }
      }
    }

    if (!items.length && rows.length) {
      // Useful fallback while testing: a pasted table without descriptions still
      // creates all biotech rows.
      for (const row of rows) {
        items.push(...this.expandRow({
          sectionName: row.parentName || row.name,
          descriptionLines: [],
          row,
          warnings: []
        }));
      }
    }

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

  isBiotechHeader(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/gu, " ").trim();
    return normalized.includes("GEAR")
      && normalized.includes("AVAIL")
      && normalized.includes("COST");
  }

  collectTableLines(lines = [], startIndex = 0) {
    const tableLines = [];
    let index = startIndex;
    let parsedAnyDataRow = false;

    while (index < lines.length) {
      const line = String(lines[index] ?? "").trim();
      if (!line) {
        index += 1;
        continue;
      }

      if (this.parseBiotechRow(line, null)) {
        tableLines.push(line);
        parsedAnyDataRow = true;
        index += 1;
        continue;
      }

      const nextLine = String(lines[index + 1] ?? "").trim();
      const isParentRow = nextLine && Boolean(this.parseBiotechRow(nextLine, line));
      if (isParentRow) {
        tableLines.push(line);
        index += 1;
        continue;
      }

      if (parsedAnyDataRow) break;

      index += 1;
    }

    return { tableLines, textStartIndex: index };
  }

  parseBiotechRows(lines = []) {
    const rows = [];
    let currentParentName = null;

    for (const rawLine of lines) {
      const line = String(rawLine ?? "").replace(/\s+/gu, " ").trim();
      if (!line) continue;

      if (currentParentName && !this.isRowCompatibleWithParent(line, currentParentName)) {
        currentParentName = null;
      }

      const row = this.parseBiotechRow(line, currentParentName);
      if (row) {
        rows.push(row);
        continue;
      }

      currentParentName = line;
    }

    return rows;
  }


  isRowCompatibleWithParent(rawRow, parentName) {
    const parent = this.normalizeMatchName(parentName);
    const parsedWithoutParent = this.parseBiotechRow(rawRow, null);
    const rowName = this.normalizeMatchName(parsedWithoutParent?.cleanName ?? parsedWithoutParent?.name ?? rawRow);

    if (parent === "docwagon contract") {
      return ["basic", "gold", "platinum", "super platinum"].includes(rowName);
    }

    if (parent === "slap patch") {
      return rowName.includes("patch");
    }

    return true;
  }

  parseBiotechRow(rawRow, parentName = null) {
    const row = this.normalizeTableRow(rawRow);
    if (!row) return null;

    const match = row.match(/^(.+?)\s+(\d+(?:\([A-Z]\))?|[-–—])\s+(.+)$/iu);
    if (!match) return null;

    const name = match[1].trim();
    const availability = match[2].trim();
    const cost = match[3].trim();

    if (!name || !this.looksLikeCost(cost)) return null;

    return {
      raw: row,
      name,
      cleanName: this.cleanRatingSuffix(name),
      normalizedName: this.normalizeMatchName(name),
      parentName: parentName || null,
      normalizedParentName: parentName ? this.normalizeMatchName(parentName) : "",
      availability,
      cost,
      ratingRange: this.extractRatingRange(name)
    };
  }

  normalizeTableRow(row) {
    return String(row ?? "")
      .replace(/\u00A0/gu, " ")
      .replace(/[–—]/gu, "–")
      .replace(/\s+/gu, " ")
      .trim();
  }

  looksLikeCost(cost) {
    const text = String(cost ?? "").trim();
    return /¥|\bmonth\b|\byear\b|\bRating\b|\d/iu.test(text);
  }

  parseDescriptionSections(lines = []) {
    const sections = [];
    let current = [];

    const flush = () => {
      const clean = current.map((line) => String(line ?? "").trim()).filter(Boolean);
      current = [];
      if (!clean.length) return;

      sections.push({
        name: clean[0],
        descriptionLines: clean.slice(1)
      });
    };

    for (const line of lines) {
      if (String(line ?? "").trim() === "---") {
        flush();
      } else if (this.looksLikeSectionTitle(line, current)) {
        flush();
        current.push(line);
      } else {
        current.push(line);
      }
    }

    flush();
    return sections;
  }

  looksLikeSectionTitle(line, current = []) {
    const text = String(line ?? "").trim();
    if (!text) return false;
    if (!current.length) return true;
    if (text.length > 60) return false;
    if (/[.!?:;,]$/u.test(text)) return false;
    if (/^(wireless bonus|for rules|upon receiving|gold service|platinum service|super-platinum subscribers)\b/iu.test(text)) return false;

    // Most section titles in these gear chapters are short title-case labels.
    // This also catches "Supplies", which maps to "Medkit supplies".
    return /^[A-Z][A-Za-z0-9'’\-/]+(?:\s+[A-Z][A-Za-z0-9'’\-/]+){0,4}$/u.test(text);
  }

  descriptionLinesForRow(section, row, rows = []) {
    if (!section || !row) return section?.descriptionLines ?? [];

    const parent = this.normalizeMatchName(row.parentName);
    if (parent !== "slap patch") return section.descriptionLines ?? [];

    const split = this.splitParentDescriptionByChildRows(section.descriptionLines, rows, row.parentName);
    if (!split.childSections.size) return split.parentIntro;

    const childKey = this.normalizeMatchName(row.cleanName || row.name);
    const childLines = split.childSections.get(childKey);
    return [...split.parentIntro, ...(childLines ?? [])];
  }

  splitParentDescriptionByChildRows(descriptionLines = [], rows = [], parentName = "") {
    const childNames = new Set(
      rows
        .filter((row) => this.normalizeMatchName(row.parentName) === this.normalizeMatchName(parentName))
        .map((row) => this.normalizeMatchName(row.cleanName || row.name))
        .filter(Boolean)
    );

    const parentIntro = [];
    const childSections = new Map();
    let currentChildKey = null;

    for (const rawLine of descriptionLines) {
      const line = String(rawLine ?? "").trim();
      if (!line) continue;

      const normalizedLine = this.normalizeMatchName(line);
      if (childNames.has(normalizedLine)) {
        currentChildKey = normalizedLine;
        if (!childSections.has(currentChildKey)) childSections.set(currentChildKey, []);
        continue;
      }

      if (currentChildKey) {
        childSections.get(currentChildKey).push(line);
      } else {
        parentIntro.push(line);
      }
    }

    return { parentIntro, childSections };
  }

  findRowsForSection(sectionName, rows = []) {
    const wanted = this.normalizeMatchName(sectionName);
    if (!wanted) return [];

    const aliases = this.sectionAliases(wanted);

    const byParent = rows.filter((row) => aliases.includes(row.normalizedParentName));
    if (byParent.length) return byParent;

    const exact = rows.filter((row) => aliases.includes(this.normalizeMatchName(row.cleanName)));
    if (exact.length) return exact;

    const contains = rows.filter((row) => {
      const rowName = this.normalizeMatchName(row.cleanName);
      return aliases.some((alias) => rowName.includes(alias) || alias.includes(rowName));
    });
    if (contains.length) return contains;

    return [];
  }

  sectionAliases(normalizedSectionName) {
    const aliases = new Set([normalizedSectionName]);

    if (normalizedSectionName === "supplies") {
      aliases.add("medkit supplies");
    }

    if (normalizedSectionName === "docwagon contract") {
      aliases.add("docwagon contracts");
    }

    if (normalizedSectionName === "docwagon contracts") {
      aliases.add("docwagon contract");
    }

    if (normalizedSectionName === "slap patch") {
      aliases.add("slap patches");
    }

    if (normalizedSectionName === "slap patches") {
      aliases.add("slap patch");
    }

    return [...aliases];
  }

  normalizeMatchName(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/[’']/gu, "")
      .replace(/\(\s*rating\s+\d+\s*[–-]\s*\d+\s*\)/giu, "")
      .replace(/[^a-z0-9]+/gu, " ")
      .replace(/\bcontracts\b/gu, "contract")
      .replace(/\bpatches\b/gu, "patch")
      .replace(/\s+/gu, " ")
      .trim();
  }

  cleanRatingSuffix(name) {
    return String(name ?? "")
      .replace(/\(\s*rating\s+\d+\s*[–-]\s*\d+\s*\)/giu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  extractRatingRange(name) {
    const match = String(name ?? "").match(/\(\s*rating\s+(\d+)\s*[–-]\s*(\d+)\s*\)/iu);
    if (!match) return null;

    const min = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) return null;

    return { min, max };
  }

  expandRow({ sectionName, descriptionLines = [], row, warnings = [] }) {
    const description = this.descriptionHtml(descriptionLines);
    const ratingRange = row?.ratingRange;

    const baseName = this.displayNameForRow(row, sectionName);

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

  displayNameForRow(row, sectionName = "") {
    const cleanName = row?.cleanName || row?.name || sectionName || "Unnamed Biotech Gear";
    const parent = this.normalizeMatchName(row?.parentName);

    if (parent === "docwagon contract") {
      return /^docwagon\b/iu.test(cleanName) ? cleanName : `DocWagon ${cleanName}`;
    }

    if (parent === "slap patch") {
      return /^slap\s+patches\s*-/iu.test(cleanName) ? cleanName : `Slap Patches - ${cleanName}`;
    }

    return cleanName;
  }

  descriptionHtml(lines = []) {
    const text = lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();

    return text ? `<p>${text}</p>` : "";
  }

  resolveSubtype(row) {
    const biologySubtypes = CONFIG?.SR6?.GEAR_SUBTYPES?.BIOLOGY ?? {};
    const keys = Object.keys(biologySubtypes);

    if (this.normalizeMatchName(row?.parentName) === "slap patch" || this.normalizeMatchName(row?.parentName) === "slap patches") {
      return this.resolveSubtypeKey("SLAP_PATCHES", keys) ?? "SLAP_PATCHES";
    }

    return this.resolveSubtypeKey("BIOTECH", keys)
      ?? keys.find((key) => key !== "SLAP_PATCHES")
      ?? "BIOTECH";
  }

  resolveSubtypeKey(preferredKey, keys = []) {
    if (!keys.length) return preferredKey;
    const normalizedPreferred = this.normalizeConfigKey(preferredKey);
    return keys.find((key) => this.normalizeConfigKey(key) === normalizedPreferred) ?? null;
  }

  normalizeConfigKey(key) {
    return String(key ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "");
  }

  parsePrice(rawCost, rating = 0) {
    const original = String(rawCost ?? "").trim();
    if (!original) return { price: 0, priceDef: 0 };

    if (rating > 0 && /rating/iu.test(original)) {
      const value = this.evaluateRatingFormula(original, rating);
      return {
        price: value,
        priceDef: value || original
      };
    }

    const firstPrice = original.match(/\d[\d,._\s]*/u)?.[0];
    if (!firstPrice) return { price: 0, priceDef: original };

    const value = Number(firstPrice.replace(/[,._\s]/gu, ""));
    return {
      price: Number.isFinite(value) ? value : 0,
      priceDef: Number.isFinite(value) ? value : original
    };
  }

  evaluateRatingFormula(rawCost, rating) {
    const text = String(rawCost ?? "").toLowerCase();

    // (Rating x Rating) x 10¥
    const square = text.match(/rating\s*x\s*rating\s*\)?\s*x\s*(\d[\d,._]*)/iu);
    if (square) {
      return rating * rating * Number(square[1].replace(/[,._]/gu, ""));
    }

    // Rating x 250¥
    const linear = text.match(/rating\s*x\s*(\d[\d,._]*)/iu);
    if (linear) {
      return rating * Number(linear[1].replace(/[,._]/gu, ""));
    }

    return 0;
  }

  toFoundryItem({ name, description = "", row = null, rating = 0, needsRating = false, warnings = [] } = {}) {
    const parsedPrice = this.parsePrice(row?.cost, rating);

    return {
      name: name || "Unnamed Biotech Gear",
      type: "gear",
      img: "systems/shadowrun6-eden/icons/compendium/gear/tech_bag.svg",
      system: {
        genesisID: "",
        description: description ?? "",
        product: "",
        page: 0,
        modifier: 0,
        wild: false,
        pool: 0,
        type: "BIOLOGY",
        subtype: this.resolveSubtype(row),
        count: 0,
        countable: false,
        availDef: row?.availability ?? "",
        avail: this.extractFirstInteger(row?.availability, 0),
        ammocap: 0,
        ammocount: 0,
        ammoLoaded: "regular",
        priceDef: parsedPrice.priceDef,
        price: parsedPrice.price,
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
          warnings
        }
      }
    };
  }
}
