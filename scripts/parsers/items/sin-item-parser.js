import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

/**
 * Parser for the Shadowrun 6 fake SIN / fake license table.
 *
 * Foundry's Shadowrun 6 Eden SIN document does not expose dedicated rating,
 * availability, or price fields. The parser therefore:
 *   - creates one `sin` item for each rating found in the matching prose;
 *   - maps ratings 1-6 to the system's SIN quality values;
 *   - keeps rating, availability, and cost in the description and flags.
 */
export class SinItemParser extends BaseItemParser {
  static TABLE_HEADER = /^TYPE\s+AVAIL(?:ABILITY)?\s+COST$/iu;

  static QUALITY_BY_RATING = Object.freeze({
    1: "ANYONE",
    2: "ROUGH_MATCH",
    3: "GOOD_MATCH",
    4: "SUPERFICIALLY_PLAUSIBLE",
    5: "HIGHLY_PLAUSIBLE",
    6: "SECOND_LIFE"
  });

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    const headerIndex = lines.findIndex((line) => SinItemParser.TABLE_HEADER.test(this.normalizeLine(line)));

    if (headerIndex < 0) {
      ui.notifications?.warn('No SIN table header found for "TYPE AVAIL COST".');
      return [];
    }

    const { rows, nextIndex } = this.parseTableRows(lines, headerIndex + 1);
    if (!rows.length) {
      ui.notifications?.warn("No SIN rows were recognized below the table header.");
      return [];
    }

    const descriptions = this.parseDescriptionSections(lines.slice(nextIndex), rows);
    const items = [];

    for (const row of rows) {
      const descriptionLines = descriptions.get(row.normalizedName) ?? [];
      const descriptionText = this.joinWrappedText(descriptionLines);
      const ratingRange = this.extractRatingRange(descriptionText);

      if (!ratingRange) {
        items.push(this.toFoundryItem({
          name: row.name,
          row,
          rating: 0,
          descriptionText,
          warnings: [`No rating range was found in the description for "${row.name}". Check the imported item manually.`]
        }));
        continue;
      }

      for (let rating = ratingRange.min; rating <= ratingRange.max; rating += 1) {
        items.push(this.toFoundryItem({
          name: `${row.name} (Rating ${rating})`,
          row,
          rating,
          descriptionText,
          warnings: []
        }));
      }
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
    if (!normalized || SinItemParser.TABLE_HEADER.test(normalized)) return null;

    const match = normalized.match(
      /^(.+?)\s+((?:\d+|[–—-])(?:\s*\([A-Z]\))?)\s+((?:Rating\s*[x×]\s*\d[\d,._\s]*|\+?\d[\d,._\s]*)\s*¥?|[–—-])$/iu
    );

    if (!match) return null;

    const name = String(match[1] ?? "").trim();
    if (!name) return null;

    return {
      raw: normalized,
      name,
      normalizedName: this.normalizeComparableName(name),
      availability: String(match[2] ?? "").trim(),
      cost: String(match[3] ?? "").trim()
    };
  }

  parseDescriptionSections(lines = [], rows = []) {
    const rowNames = new Map(rows.map((row) => [row.normalizedName, row]));
    const sections = new Map();
    let currentKey = "";

    for (const rawLine of lines) {
      const line = this.normalizeLine(rawLine);
      if (!line || this.isSeparatorLine(line) || this.isPageNoiseLine(line)) continue;

      const normalized = this.normalizeComparableName(line);
      if (rowNames.has(normalized)) {
        currentKey = normalized;
        if (!sections.has(currentKey)) sections.set(currentKey, []);
        continue;
      }

      if (!currentKey) continue;
      sections.get(currentKey).push(line);
    }

    return sections;
  }

  extractRatingRange(value) {
    const source = String(value ?? "");
    const patterns = [
      /\bratings?\s+from\s+(\d+)\s+to\s+(\d+)\b/iu,
      /\bavailable\s+in\s+ratings?\s+from\s+(\d+)\s+to\s+(\d+)\b/iu,
      /\bratings?\s*\(\s*(\d+)\s*[–—-]\s*(\d+)\s*\)/iu,
      /\bratings?\s+(\d+)\s*[–—-]\s*(\d+)\b/iu
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

  resolveAvailability(rawValue) {
    const raw = String(rawValue ?? "").trim();
    if (!raw || /^[–—-]$/u.test(raw)) return { availDef: "", avail: 0, legality: "" };

    const match = raw.match(/^(\d+)\s*(?:\(([A-Z])\)|([A-Z]))?$/iu);
    if (!match) {
      return {
        availDef: raw,
        avail: this.extractFirstInteger(raw, 0),
        legality: ""
      };
    }

    const legality = String(match[2] ?? match[3] ?? "").toUpperCase();
    return {
      availDef: `${match[1]}${legality ? `(${legality})` : ""}`,
      avail: Number(match[1]),
      legality
    };
  }

  resolveCost(rawValue, rating = 0) {
    const raw = String(rawValue ?? "").trim();
    if (!raw || /^[–—-]$/u.test(raw)) return { price: 0, priceDef: 0 };

    const formula = raw.match(/rating\s*[x×]\s*(\d[\d,._\s]*)/iu);
    if (formula && rating > 0) {
      const multiplier = this.parseNumber(formula[1]);
      const price = Number.isFinite(multiplier) ? multiplier * rating : 0;
      return { price, priceDef: price };
    }

    const price = this.parseNumber(raw);
    return {
      price: Number.isFinite(price) ? price : 0,
      priceDef: Number.isFinite(price) ? price : raw
    };
  }

  resolveQuality(rating) {
    return SinItemParser.QUALITY_BY_RATING[Number(rating)] ?? "ANYONE";
  }

  buildDescription(descriptionText, { rating, availability, cost }) {
    const body = descriptionText ? `<p>${this.escapeHtml(descriptionText)}</p>` : "";
    const metadata = [
      rating > 0 ? `<p><strong>Rating:</strong> ${rating}</p>` : "",
      availability.availDef ? `<p><strong>Availability:</strong> ${availability.availDef}</p>` : "",
      `<p><strong>Cost:</strong> ${this.formatNuyen(cost.price)}</p>`
    ].filter(Boolean).join("");

    return `${body}${metadata}`;
  }

  toFoundryItem({ name, row, rating = 0, descriptionText = "", warnings = [] } = {}) {
    const availability = this.resolveAvailability(row?.availability);
    const cost = this.resolveCost(row?.cost, rating);

    return {
      name: name || row?.name || "Unnamed SIN",
      type: "sin",
      img: "icons/svg/mystery-man.svg",
      system: {
        name: row?.name || name || "Someone",
        quality: this.resolveQuality(rating),
        description: this.buildDescription(descriptionText, {
          rating,
          availability,
          cost
        })
      },
      effects: [],
      folder: this.folderId ?? null,
      flags: {
        [SII.MODULE_ID]: {
          sourceParser: this.constructor.name,
          tableRow: row,
          rating,
          availability,
          cost: {
            formula: row?.cost ?? "",
            price: cost.price,
            priceDef: cost.priceDef
          },
          warnings
        }
      }
    };
  }

  parseNumber(value) {
    const match = String(value ?? "").match(/\d[\d,._\s]*/u);
    if (!match) return Number.NaN;
    return Number(match[0].replace(/[,._\s]/gu, ""));
  }

  formatNuyen(value) {
    const amount = Number(value) || 0;
    return `${amount.toLocaleString("en-US")}¥`;
  }

  normalizeLine(value) {
    return String(value ?? "")
      .replace(/\u00A0/gu, " ")
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

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }
}
