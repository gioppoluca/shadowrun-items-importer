import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

/**
 * Parser for Shadowrun 6 Eden audio enhancement tables.
 *
 * Supported table layout:
 *   ENHANCEMENT CAPACITY AVAIL COST
 *
 * Audio enhancements are Item documents of type "mod" with system.type set
 * to "audio_enhancement". Rating-based rows are expanded by reading the
 * rating range from the matching prose block.
 */
export class GearAudioEnhancementParser extends BaseItemParser {
  constructor({ text, type, folderId }) {
    super({ text, type, folderId });
    this.modType = "audio_enhancement";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return this.toFoundryItem({ name: "Unnamed Audio Enhancement" });

    const headerIndex = lines.findIndex((line) => this.isTableHeader(line));
    if (headerIndex < 0) {
      const name = lines[0] ?? "Unnamed Audio Enhancement";
      return this.toFoundryItem({
        name,
        description: this.descriptionHtml(lines.slice(1)),
        warnings: [`No audio enhancement table header found for "${name}". Import created with description only.`]
      });
    }

    const introLines = lines.slice(0, headerIndex);
    const afterHeaderLines = lines.slice(headerIndex + 1);
    const { tableLines, trailingLines } = this.splitTableLines(afterHeaderLines);
    const rows = this.parseRows(tableLines);

    if (!rows.length) {
      ui.notifications?.warn("No audio enhancement table rows were found.");
      return [];
    }

    const introBlocks = this.parseDescriptionBlocks(introLines);
    const trailingBlocks = this.parseDescriptionBlocks(trailingLines);
    const descriptionBlocks = this.selectDescriptionBlocks(introBlocks, trailingBlocks, rows);
    const descriptionsByRow = this.matchDescriptionsToRows(descriptionBlocks, rows);

    const items = [];
    for (const row of rows) {
      const descriptionBlock = descriptionsByRow.get(row.normalizedName) ?? null;
      const description = descriptionBlock
        ? this.descriptionHtml(descriptionBlock.descriptionLines)
        : "";

      items.push(...this.expandRow(row, description));
    }

    return items.length === 1 ? items[0] : items;
  }

  isTableHeader(line) {
    return /^ENHANCEMENT\s+CAPACITY\s+AVAIL(?:ABILITY)?\s+COST\b/iu.test(String(line ?? "").trim());
  }

  splitTableLines(lines = []) {
    const source = Array.isArray(lines) ? lines : [];
    let buffer = [];
    let lastValidRowEnd = -1;

    for (let index = 0; index < source.length; index += 1) {
      const line = String(source[index] ?? "").trim();
      if (!line || this.isTableHeader(line)) continue;
      if (/^-{3,}$/u.test(line)) break;

      buffer.push(line);
      if (!/¥\s*$/u.test(line)) continue;

      if (this.parseRow(buffer.join(" "))) {
        lastValidRowEnd = index;
        buffer = [];
      }
    }

    if (lastValidRowEnd < 0) {
      return { tableLines: source, trailingLines: [] };
    }

    return {
      tableLines: source.slice(0, lastValidRowEnd + 1),
      trailingLines: source.slice(lastValidRowEnd + 1)
    };
  }

  parseRows(lines = []) {
    const rows = [];
    let buffer = [];

    for (const rawLine of lines) {
      const line = String(rawLine ?? "").trim();
      if (!line || this.isTableHeader(line)) continue;
      if (/^-{3,}$/u.test(line)) break;

      buffer.push(line);
      if (!/¥\s*$/u.test(line)) continue;

      const row = this.parseRow(buffer.join(" "));
      if (row) rows.push(row);
      buffer = [];
    }

    if (buffer.length) {
      const row = this.parseRow(buffer.join(" "));
      if (row) rows.push(row);
    }

    return rows;
  }

  parseRow(rawRow) {
    const normalized = String(rawRow ?? "")
      .replace(/\u00A0/gu, " ")
      .replace(/[–—]/gu, "—")
      .replace(/\s+/gu, " ")
      .trim();

    const match = normalized.match(
      /^(.*?)\s+(\[\s*(?:\d+|RATING)\s*\]|\d+|—)\s+(\d+(?:\([A-Z]\)|[A-Z])?|—)\s+(.+?¥)\s*$/iu
    );
    if (!match) return null;

    const name = match[1].trim();
    const capacityRaw = match[2].replace(/\s+/gu, "");
    const availabilityRaw = match[3].trim();
    const cost = match[4].trim();
    if (!name) return null;

    return {
      raw: normalized,
      name,
      normalizedName: this.normalizeComparableName(name),
      capacityRaw,
      capacity: this.extractFirstInteger(capacityRaw, 0),
      usesRating: /rating/iu.test(capacityRaw) || /rating/iu.test(cost),
      availabilityRaw,
      availability: this.normalizeAvailability(availabilityRaw),
      cost
    };
  }

  parseDescriptionBlocks(lines = []) {
    const blocks = [];
    let current = [];

    const flush = () => {
      const cleaned = current.map((line) => String(line ?? "").trim()).filter(Boolean);
      current = [];
      if (!cleaned.length) return;
      blocks.push({
        name: cleaned[0],
        normalizedName: this.normalizeComparableName(cleaned[0]),
        descriptionLines: cleaned.slice(1)
      });
    };

    for (const line of lines) {
      if (/^-{3,}$/u.test(String(line ?? "").trim())) flush();
      else current.push(line);
    }
    flush();

    return blocks;
  }

  selectDescriptionBlocks(introBlocks, trailingBlocks, rows) {
    const before = Array.isArray(introBlocks) ? introBlocks : [];
    const after = Array.isArray(trailingBlocks) ? trailingBlocks : [];

    if (!before.length && !after.length) return [];
    if (!before.length) return after;
    if (!after.length) return before;

    return this.scoreDescriptionBlocks(after, rows) > this.scoreDescriptionBlocks(before, rows)
      ? after
      : before;
  }

  scoreDescriptionBlocks(blocks, rows) {
    return blocks.reduce((score, block) => {
      if (!block?.normalizedName) return score;
      if (rows.some((row) => row.normalizedName === block.normalizedName)) return score + 100;
      if (rows.some((row) => row.normalizedName.includes(block.normalizedName)
        || block.normalizedName.includes(row.normalizedName))) {
        return score + 10;
      }
      return score;
    }, 0);
  }

  matchDescriptionsToRows(blocks, rows) {
    const result = new Map();

    for (const block of blocks) {
      const row = rows.find((candidate) => candidate.normalizedName === block.normalizedName)
        ?? rows.find((candidate) => candidate.normalizedName.includes(block.normalizedName)
          || block.normalizedName.includes(candidate.normalizedName));
      if (row && !result.has(row.normalizedName)) result.set(row.normalizedName, block);
    }

    return result;
  }

  expandRow(row, description) {
    if (!row?.usesRating) {
      return [this.toFoundryItem({
        name: row?.name,
        description,
        row
      })];
    }

    const ratingRange = this.extractRatingRange(description);
    if (!ratingRange) {
      return [this.toFoundryItem({
        name: row?.name,
        description,
        row,
        warnings: [`No rating range found in the description for "${row?.name}". Import created without rating expansion.`]
      })];
    }

    const items = [];
    for (let rating = ratingRange.min; rating <= ratingRange.max; rating += 1) {
      items.push(this.toFoundryItem({
        name: `${row.name} (Rating ${rating})`,
        description,
        row,
        rating,
        ratingRange
      }));
    }
    return items;
  }

  extractRatingRange(descriptionHtml) {
    const source = String(descriptionHtml ?? "")
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();

    const patterns = [
      /ratings?\s+(?:of|from)\s+(\d+)\s+(?:to|through)\s+(\d+)/iu,
      /ratings?\s+(\d+)\s+(?:to|through)\s+(\d+)/iu,
      /ratings?\s+(?:of|from)?\s*(\d+)\s*[–—-]\s*(\d+)/iu
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;

      const min = Number(match[1]);
      const max = Number(match[2]);
      if (Number.isInteger(min) && Number.isInteger(max) && min > 0 && max >= min) {
        return { min, max };
      }
    }

    return null;
  }

  normalizeComparableName(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/[’']/gu, "")
      .replace(/[^a-z0-9]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  normalizeAvailability(value) {
    const raw = String(value ?? "").trim();
    if (!raw || raw === "—") return "";

    const match = raw.match(/^(\d+)\s*(?:\(([A-Z])\)|([A-Z]))?$/iu);
    if (!match) return raw;

    const suffix = (match[2] ?? match[3] ?? "").toUpperCase();
    return `${match[1]}${suffix}`;
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

  resolveCost(rawCost, rating = 0) {
    const original = String(rawCost ?? "").trim();
    if (!original) return { price: 0, priceDef: 0 };

    const formula = original.match(/rating\s*[x×]\s*(\d[\d,._\s]*)/iu);
    if (formula) {
      const multiplier = this.parseNumber(formula[1]);
      const value = Number(rating) * multiplier;
      return {
        price: Number.isFinite(value) ? value : 0,
        priceDef: Number.isFinite(value) ? value : original
      };
    }

    const value = this.parseNumber(original);
    return {
      price: Number.isFinite(value) ? value : 0,
      priceDef: Number.isFinite(value) ? value : original
    };
  }

  parseNumber(value) {
    const match = String(value ?? "").match(/\d[\d,._\s]*/u);
    if (!match) return Number.NaN;
    return Number(match[0].replace(/[,._\s]/gu, ""));
  }

  toFoundryItem({ name, description = "", row = null, rating = 0, ratingRange = null, warnings = [] } = {}) {
    const parsedCost = this.resolveCost(row?.cost, rating);
    const resolvedCapacity = rating > 0 ? rating : (row?.capacity ?? 0);
    const capacityRaw = rating > 0 ? `[${rating}]` : (row?.capacityRaw ?? "");
    const capacityNote = capacityRaw
      ? `<p><strong>Capacity:</strong> ${capacityRaw}</p>`
      : "";
    const ratingNote = rating > 0
      ? `<p><strong>Rating:</strong> ${rating}</p>`
      : "";

    return {
      name: name || row?.name || "Unnamed Audio Enhancement",
      type: "mod",
      img: "systems/shadowrun6-eden/icons/compendium/black-chrome/explicit-memory-stimulator.svg",
      system: {
        description: [description ?? "", capacityNote, ratingNote].filter(Boolean).join(""),
        availDef: row?.availability ?? "",
        price: parsedCost.price,
        page: null,
        embeddedInUuid: null,
        type: this.modType
      },
      effects: [],
      folder: this.folderId ?? null,
      flags: {
        [SII.MODULE_ID]: {
          sourceParser: this.constructor.name,
          tableRow: row,
          capacity: resolvedCapacity,
          capacityRaw,
          originalCapacityRaw: row?.capacityRaw ?? "",
          rating,
          ratingRange,
          priceDef: parsedCost.priceDef,
          warnings
        }
      }
    };
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
