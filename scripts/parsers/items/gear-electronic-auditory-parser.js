import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

/**
 * Parser for the Auditory Devices table.
 *
 * Capacity is represented through the legacy gear rating fields as well as the
 * dedicated capacity field. Rows containing a capacity range are expanded into
 * one Foundry item for every capacity value in that range.
 */
export class GearElectronicAuditoryParser extends BaseItemParser {
  static GEAR_TYPE = "ELECTRONICS";
  static GEAR_SUBTYPE = "AUDIO";

  static TABLE_HEADER = /^DEVICE\s+CAPACITY\s+AVAIL(?:ABILITY)?\s+COST$/iu;

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    const headerIndex = lines.findIndex((line) => GearElectronicAuditoryParser.TABLE_HEADER.test(this.normalizeLine(line)));

    if (headerIndex < 0) {
      ui.notifications?.warn('No auditory-device table header found for "DEVICE CAPACITY AVAIL COST".');
      return [];
    }

    const { rows, nextIndex } = this.parseTableRows(lines, headerIndex + 1);
    const descriptionLines = [
      ...lines.slice(0, headerIndex),
      ...lines.slice(nextIndex)
    ];
    const descriptions = this.parseDescriptionSections(descriptionLines, rows);
    const warnings = [];
    const items = [];

    for (const row of rows) {
      const description = this.descriptionForRow(row, descriptions);
      const capacities = this.capacitiesForRow(row);

      for (const capacity of capacities) {
        items.push(this.toFoundryItem({
          row,
          capacity,
          rangedCapacity: Boolean(row.capacityRange),
          description,
          warnings
        }));
      }
    }

    if (!rows.length) {
      ui.notifications?.warn("No auditory device rows were recognized below the table header.");
    }

    return items;
  }

  parseTableRows(lines, startIndex) {
    const rows = [];
    let index = startIndex;

    while (index < lines.length) {
      const line = this.normalizeLine(lines[index]);
      if (!line) {
        index += 1;
        continue;
      }
      if (this.isSeparatorLine(line) || this.isPageNoiseLine(line)) break;

      let parsed = null;
      let consumed = 0;
      let combined = "";

      // PDF extraction can wrap multi-word auditory device names over two
      // lines. Parse up to three joined lines,
      // while still anchoring the numeric columns at the right side.
      for (let span = 1; span <= 3 && index + span <= lines.length; span += 1) {
        const part = this.normalizeLine(lines[index + span - 1]);
        if (!part || this.isSeparatorLine(part) || this.isPageNoiseLine(part)) break;

        combined = `${combined} ${part}`.trim();
        parsed = this.parseTableRow(combined);
        if (parsed) {
          consumed = span;
          break;
        }
      }

      if (!parsed) break;

      rows.push(parsed);
      index += consumed;
    }

    return { rows, nextIndex: index };
  }

  parseTableRow(line) {
    const normalized = this.normalizeLine(line);
    if (!normalized || GearElectronicAuditoryParser.TABLE_HEADER.test(normalized)) return null;

    const match = normalized.match(
      /^(.+?)\s+(\d+\s*[–—-]\s*\d+|\d+|[–—-])\s+(\d+(?:\s*\([A-Z]\)|[A-Z])?|[–—-])\s+((?:Capacity\s*[x×]\s*\d[\d,._\s]*|\+?\d[\d,._\s]*)\s*¥?|[–—-])$/iu
    );

    if (!match) return null;

    const name = String(match[1] ?? "").trim();
    const capacityDef = String(match[2] ?? "").trim();
    const availability = String(match[3] ?? "").trim();
    const cost = String(match[4] ?? "").trim();
    if (!name) return null;

    return {
      raw: normalized,
      name,
      normalizedName: this.normalizeComparableName(name),
      capacityDef,
      capacityRange: this.extractCapacityRange(capacityDef),
      fixedCapacity: this.extractFixedCapacity(capacityDef),
      availability,
      cost
    };
  }

  extractCapacityRange(value) {
    const match = String(value ?? "").match(/^(\d+)\s*[–—-]\s*(\d+)$/u);
    if (!match) return null;

    const min = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) return null;
    return { min, max };
  }

  extractFixedCapacity(value) {
    const source = String(value ?? "").trim();
    if (!/^\d+$/u.test(source)) return 0;
    return Number(source);
  }

  capacitiesForRow(row) {
    if (row?.capacityRange) {
      return Array.from(
        { length: row.capacityRange.max - row.capacityRange.min + 1 },
        (_value, index) => row.capacityRange.min + index
      );
    }

    return [Number(row?.fixedCapacity) || 0];
  }

  parseDescriptionSections(lines = [], rows = []) {
    const sections = new Map();
    let currentKey = "";

    for (const rawLine of lines) {
      const line = this.normalizeLine(rawLine);
      if (!line || this.isPageNoiseLine(line)) continue;

      if (this.isSeparatorLine(line)) {
        currentKey = "";
        continue;
      }

      const headingKey = this.resolveDescriptionHeading(line, rows);
      if (headingKey) {
        currentKey = headingKey;
        if (!sections.has(currentKey)) sections.set(currentKey, []);
        continue;
      }

      if (!currentKey) continue;
      const values = sections.get(currentKey) ?? [];
      values.push(line);
      sections.set(currentKey, values);
    }

    return sections;
  }

  resolveDescriptionHeading(line, rows = []) {
    const normalizedLine = this.normalizeComparableName(line);
    if (!normalizedLine) return "";

    for (const row of rows) {
      for (const candidate of this.descriptionKeysForName(row.name)) {
        if (normalizedLine === candidate) return candidate;
      }
    }

    return "";
  }

  descriptionForRow(row, sections) {
    for (const key of this.descriptionKeysForName(row?.name)) {
      const lines = sections.get(key);
      if (lines?.length) return this.descriptionHtml(lines);
    }

    // Some table variants are described inside the parent device section rather
    // than receiving a separate heading. Match them generically by looking for
    // the normalized row name inside the section body (ignoring punctuation and
    // spaces, so "Micro-camera" matches "microcamera").
    const rowKeys = this.descriptionKeysForName(row?.name)
      .map((key) => key.replace(/\s+/gu, ""))
      .filter((key) => key.length >= 5);

    for (const lines of sections.values()) {
      const compactBody = this.normalizeComparableName(lines.join(" ")).replace(/\s+/gu, "");
      if (rowKeys.some((key) => compactBody.includes(key))) {
        return this.descriptionHtml(lines);
      }
    }

    return "";
  }

  descriptionKeysForName(name) {
    const original = String(name ?? "").trim();
    const baseBeforeComma = original.split(",")[0]?.trim() ?? original;
    const values = [original, baseBeforeComma];
    const keys = [];

    for (const value of values) {
      const normalized = this.normalizeComparableName(value);
      if (!normalized) continue;
      keys.push(normalized);

      // Allow singular/plural heading variations without maintaining an item
      // alias table.
      if (normalized.endsWith("s") && normalized.length > 3) {
        keys.push(normalized.slice(0, -1));
      } else {
        keys.push(`${normalized}s`);
      }
    }

    return [...new Set(keys)];
  }

  descriptionHtml(lines = []) {
    const text = lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();

    return text ? `<p>${this.escapeHtml(text)}</p>` : "";
  }

  toFoundryItem({ row, capacity = 0, rangedCapacity = false, description = "", warnings = [] } = {}) {
    const availability = this.resolveAvailability(row?.availability);
    const cost = this.resolveCost(row?.cost, capacity);
    const hasCapacity = Number.isInteger(capacity) && capacity > 0;
    const baseName = row?.name || "Unnamed Auditory Device";
    const name = rangedCapacity ? `${baseName} (Capacity ${capacity})` : baseName;

    return {
      name,
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
        type: GearElectronicAuditoryParser.GEAR_TYPE,
        subtype: GearElectronicAuditoryParser.GEAR_SUBTYPE,
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
        needsRating: hasCapacity,
        rating: hasCapacity ? capacity : 0,
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
        capacity: hasCapacity ? capacity : 0,
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
          capacity,
          capacityFormula: /capacity/iu.test(row?.cost ?? "") ? row.cost : null,
          warnings
        }
      }
    };
  }

  resolveAvailability(rawValue) {
    const raw = String(rawValue ?? "").trim();
    if (!raw || /^[–—-]$/u.test(raw)) return { availDef: "", avail: 0 };

    const match = raw.match(/^(\d+)\s*(?:\(([A-Z])\)|([A-Z]))?$/iu);
    if (!match) return { availDef: raw, avail: this.extractFirstInteger(raw, 0) };

    const suffix = (match[2] ?? match[3] ?? "").toUpperCase();
    return {
      availDef: `${match[1]}${suffix}`,
      avail: Number(match[1])
    };
  }

  resolveCost(rawValue, capacity = 0) {
    const raw = String(rawValue ?? "").trim();
    if (!raw || /^[–—-]$/u.test(raw)) return { priceDef: 0, price: 0 };

    const formula = raw.match(/capacity\s*[x×]\s*(\d[\d,._\s]*)/iu);
    if (formula) {
      const multiplier = this.parseNumber(formula[1]);
      const value = Number(capacity) * multiplier;
      return {
        priceDef: Number.isFinite(value) ? value : raw,
        price: Number.isFinite(value) ? value : 0
      };
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

  normalizeComparableName(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[’']/gu, "")
      .replace(/[^a-z0-9]+/gu, " ")
      .replace(/\bmic\b/gu, "microphone")
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

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }
}
