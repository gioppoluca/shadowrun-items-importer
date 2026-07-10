import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

/**
 * Parser for Shadowrun 6 Eden visual enhancement tables.
 *
 * Supported table layout:
 *   ENHANCEMENT CAPACITY AVAIL COST
 *
 * Visual enhancements are Item documents of type "mod" with system.type set
 * to "visual_enhancement". The Eden mod data model has no dedicated capacity
 * field, so the table value is retained in the description and importer flags.
 */
export class GearVisualEnhancementParser extends BaseItemParser {
  constructor({ text, type, folderId }) {
    super({ text, type, folderId });
    this.modType = "visual_enhancement";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return this.toFoundryItem({ name: "Unnamed Visual Enhancement" });

    const headerIndex = lines.findIndex((line) => this.isTableHeader(line));
    if (headerIndex < 0) {
      const name = lines[0] ?? "Unnamed Visual Enhancement";
      return this.toFoundryItem({
        name,
        description: this.descriptionHtml(lines.slice(1)),
        warnings: [`No visual enhancement table header found for "${name}". Import created with description only.`]
      });
    }

    const introLines = lines.slice(0, headerIndex);
    const afterHeaderLines = lines.slice(headerIndex + 1);
    const { tableLines, trailingLines } = this.splitTableLines(afterHeaderLines);
    const rows = this.parseRows(tableLines);

    if (!rows.length) {
      ui.notifications?.warn("No visual enhancement table rows were found.");
      return [];
    }

    const introBlocks = this.parseDescriptionBlocks(introLines);
    const trailingBlocks = this.parseDescriptionBlocks(trailingLines);
    const descriptionBlocks = this.selectDescriptionBlocks(introBlocks, trailingBlocks, rows);

    // A table without prose imports every row. When prose is supplied, create
    // the described entries and match each one to its table statistics.
    if (!descriptionBlocks.length) {
      const items = rows.map((row) => this.toFoundryItem({ row, name: row.name }));
      return items.length === 1 ? items[0] : items;
    }

    const items = [];
    const emitted = new Set();

    for (const block of descriptionBlocks) {
      const row = this.findMatchingRow(block.name, rows);
      const description = this.descriptionHtml(block.descriptionLines);

      if (!row) {
        items.push(this.toFoundryItem({
          name: block.name,
          description,
          warnings: [`No matching visual enhancement table row found for "${block.name}". Check the imported item manually.`]
        }));
        continue;
      }

      if (emitted.has(row.normalizedName)) continue;
      emitted.add(row.normalizedName);

      items.push(this.toFoundryItem({
        name: row.name,
        description,
        row
      }));
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
      /^(.*?)\s+(\[\s*\d+\s*\]|\d+|—)\s+(\d+(?:\([A-Z]\)|[A-Z])?|—)\s+(\+?\s*\d[\d,._\s]*¥)\s*$/iu
    );
    if (!match) return null;

    const name = match[1].trim();
    const capacityRaw = match[2].replace(/\s+/gu, "");
    const availabilityRaw = match[3].trim();
    const cost = match[4].replace(/\s+/gu, "");
    if (!name) return null;

    return {
      raw: normalized,
      name,
      normalizedName: this.normalizeComparableName(name),
      capacityRaw,
      capacity: this.extractFirstInteger(capacityRaw, 0),
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
      const wanted = this.normalizeComparableName(block?.name);
      if (!wanted) return score;
      if (rows.some((row) => row.normalizedName === wanted)) return score + 100;
      if (rows.some((row) => row.normalizedName.includes(wanted) || wanted.includes(row.normalizedName))) {
        return score + 10;
      }
      return score;
    }, 0);
  }

  findMatchingRow(name, rows) {
    const wanted = this.normalizeComparableName(name);
    if (!wanted) return null;

    return rows.find((row) => row.normalizedName === wanted)
      ?? rows.find((row) => row.normalizedName.includes(wanted) || wanted.includes(row.normalizedName))
      ?? null;
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

    return text ? `<p>${text}</p>` : "";
  }

  parseCost(rawCost) {
    const original = String(rawCost ?? "").trim();
    if (!original) return { price: 0, priceDef: 0 };

    const normalized = original
      .replace(/¥/gu, "")
      .replace(/[,+_\s]/gu, "");
    const value = Number(normalized);

    return {
      price: Number.isFinite(value) ? Math.abs(value) : 0,
      priceDef: original
    };
  }

  toFoundryItem({ name, description = "", row = null, warnings = [] } = {}) {
    const parsedCost = this.parseCost(row?.cost);
    const capacityNote = row?.capacityRaw
      ? `<p><strong>Capacity:</strong> ${row.capacityRaw}</p>`
      : "";

    return {
      name: name || row?.name || "Unnamed Visual Enhancement",
      type: "mod",
      img: "systems/shadowrun6-eden/icons/compendium/black-chrome/explicit-memory-stimulator.svg",
      system: {
        description: [description ?? "", capacityNote].filter(Boolean).join(""),
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
          capacity: row?.capacity ?? 0,
          capacityRaw: row?.capacityRaw ?? "",
          priceDef: parsedCost.priceDef,
          warnings
        }
      }
    };
  }
}
