import { BaseItemParser } from "./base-item-parser.js";

/**
 * Parser for Shadowrun 6 Eden weapon accessory tables.
 *
 * Supported layouts:
 *   - table only: every accessory row is imported
 *   - prose blocks before the table
 *   - prose blocks after the table
 *
 * Prose blocks are separated by a line made of dashes and their first line is
 * matched against the accessory name in the table.
 *
 * Shadowrun 6 Eden stores weapon accessories as Item type "mod" with system
 * type "accessory_weapon". The system data model currently has no Mount field,
 * so the value from that column is appended to the item description.
 */
export class GearWeaponAccessoryParser extends BaseItemParser {
  constructor({ text, type, folderId }) {
    super({ text, type, folderId });
    this.modType = "accessory_weapon";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return this.toFoundryItem({ name: "Unnamed Accessory" });

    const headerIndex = this.findAccessoryTableHeaderIndex(lines);
    if (headerIndex < 0) {
      const name = lines[0] ?? "Unnamed Accessory";
      return this.toFoundryItem({
        name,
        description: this.descriptionHtml(lines.slice(1)),
        warnings: [`No accessory table header found for "${name}". Import created with description only.`]
      });
    }

    const introLines = lines.slice(0, headerIndex);
    const afterHeaderLines = lines.slice(headerIndex + 1);
    const { tableLines, trailingLines } = this.splitAccessoryTableLines(afterHeaderLines);
    const tableRows = this.parseAccessoryRows(tableLines);

    if (!tableRows.length) {
      ui.notifications?.warn("No weapon accessory table rows were found.");
      return [];
    }

    const introBlocks = this.parseRequestedAccessoryBlocks(introLines);
    const trailingBlocks = this.parseRequestedAccessoryBlocks(trailingLines);
    const requestedBlocks = this.selectRequestedAccessoryBlocks(introBlocks, trailingBlocks, tableRows);

    // A bare table means "import the complete table". When prose blocks are
    // present, preserve the previous selective-import behaviour and create only
    // the rows named by those blocks.
    if (!requestedBlocks.length) {
      const items = tableRows.map((row) => this.toFoundryItem({
        name: row.name,
        description: "",
        row,
        warnings: []
      }));
      return items.length === 1 ? items[0] : items;
    }

    const items = [];
    const emittedKeys = new Set();

    for (const block of requestedBlocks) {
      const row = this.findMatchingRow(block.name, tableRows);
      const description = this.descriptionHtml(block.descriptionLines);

      if (!row) {
        items.push(this.toFoundryItem({
          name: block.name,
          description,
          row: null,
          warnings: [`No matching accessory table row found for "${block.name}". Check the imported item manually.`]
        }));
        continue;
      }

      const key = row.normalizedName || this.normalizeComparableName(row.name);
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);

      items.push(this.toFoundryItem({
        name: row.name,
        description,
        row,
        warnings: []
      }));
    }

    return items.length === 1 ? items[0] : items;
  }

  findAccessoryTableHeaderIndex(lines) {
    return lines.findIndex((line) => this.isAccessoryTableHeader(line));
  }

  isAccessoryTableHeader(line) {
    return /^ACCESSORY\s+MOUNT\s+AVAILABILITY\s+COST\b/i.test(String(line ?? "").trim());
  }

  /**
   * Separates table rows from prose extracted after the table. Accessory rows
   * can wrap, but their cost always terminates with the nuyen symbol.
   */
  splitAccessoryTableLines(lines = []) {
    const sourceLines = Array.isArray(lines) ? lines : [];
    let buffer = [];
    let lastValidRowEnd = -1;

    for (let index = 0; index < sourceLines.length; index += 1) {
      const cleaned = String(sourceLines[index] ?? "").trim();
      if (!cleaned || this.isAccessoryTableHeader(cleaned)) continue;

      buffer.push(cleaned);
      if (!/¥\s*$/u.test(cleaned)) continue;

      const parsed = this.parseAccessoryRow(buffer.join(" "));
      if (parsed) {
        lastValidRowEnd = index;
        buffer = [];
      }
    }

    if (lastValidRowEnd < 0) {
      return { tableLines: sourceLines, trailingLines: [] };
    }

    return {
      tableLines: sourceLines.slice(0, lastValidRowEnd + 1),
      trailingLines: sourceLines.slice(lastValidRowEnd + 1)
    };
  }

  parseRequestedAccessoryBlocks(lines = []) {
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
      if (/^-{3,}$/.test(String(line ?? "").trim())) {
        flush();
      } else {
        current.push(line);
      }
    }
    flush();

    return blocks;
  }

  selectRequestedAccessoryBlocks(introBlocks, trailingBlocks, rows) {
    const before = Array.isArray(introBlocks) ? introBlocks : [];
    const after = Array.isArray(trailingBlocks) ? trailingBlocks : [];

    if (!before.length && !after.length) return [];
    if (!before.length) return after;
    if (!after.length) return before;

    return this.scoreRequestedAccessoryBlocks(after, rows) > this.scoreRequestedAccessoryBlocks(before, rows)
      ? after
      : before;
  }

  scoreRequestedAccessoryBlocks(blocks, rows) {
    return blocks.reduce((score, block) => {
      const wanted = this.normalizeComparableName(block?.name);
      if (!wanted) return score;

      const exact = rows.some((row) => row.normalizedName === wanted);
      if (exact) return score + 100;

      const loose = rows.some((row) => row.normalizedName.includes(wanted) || wanted.includes(row.normalizedName));
      return score + (loose ? 10 : 0);
    }, 0);
  }

  parseAccessoryRows(tableLines) {
    const rows = [];
    let buffer = [];

    for (const line of tableLines) {
      const cleaned = String(line ?? "").trim();
      if (!cleaned || this.isAccessoryTableHeader(cleaned)) continue;

      buffer.push(cleaned);

      if (/¥\s*$/u.test(cleaned)) {
        const parsed = this.parseAccessoryRow(buffer.join(" "));
        if (parsed) rows.push(parsed);
        buffer = [];
      }
    }

    if (buffer.length) {
      const parsed = this.parseAccessoryRow(buffer.join(" "));
      if (parsed) rows.push(parsed);
    }

    return rows;
  }

  parseAccessoryRow(rawRow) {
    const normalized = this.normalizeTableRow(rawRow);
    const tokens = normalized.split(/\s+/u).filter(Boolean);
    if (tokens.length < 4) return null;

    const availabilityIndex = this.findAvailabilityIndex(tokens);
    if (availabilityIndex <= 0) return null;

    const cost = tokens.slice(availabilityIndex + 1).join(" ");
    const availabilityRaw = tokens[availabilityIndex];
    const beforeAvailability = tokens.slice(0, availabilityIndex);
    const { nameTokens, mountTokens } = this.extractNameAndMount(beforeAvailability);

    const name = nameTokens.join(" ").trim();
    const mount = mountTokens.join(" ").trim();
    if (!name || !mount) return null;

    return {
      raw: normalized,
      name,
      normalizedName: this.normalizeComparableName(name),
      mount,
      availabilityRaw,
      availability: this.normalizeAvailability(availabilityRaw),
      cost
    };
  }

  normalizeTableRow(row) {
    return String(row ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/[–—]/g, "—")
      .replace(/\s+/g, " ")
      .trim();
  }

  findAvailabilityIndex(tokens) {
    for (let i = tokens.length - 2; i >= 1; i -= 1) {
      const costCandidate = tokens.slice(i + 1).join(" ");
      if (!/¥\s*$/u.test(costCandidate)) continue;
      if (this.looksLikeAvailability(tokens[i])) return i;
    }
    return -1;
  }

  looksLikeAvailability(token) {
    return /^(?:\d+|[-–—])(?:\([A-Z]\)|[A-Z])?$/iu.test(String(token ?? ""));
  }

  normalizeAvailability(value) {
    const raw = String(value ?? "").trim();
    if (!raw || /^[-–—]$/u.test(raw)) return "";

    const match = raw.match(/^(\d+)\s*(?:\(([A-Z])\)|([A-Z]))?$/iu);
    if (!match) return raw;

    const suffix = (match[2] ?? match[3] ?? "").toUpperCase();
    return `${match[1]}${suffix}`;
  }

  /**
   * Mount values in the core table are: —, Barrel, Top, Under, Top or Under.
   * Parse them from the end so an accessory name containing one of those words
   * is not truncated accidentally.
   */
  extractNameAndMount(tokens) {
    const source = Array.isArray(tokens) ? tokens : [];
    const lowered = source.map((token) => String(token ?? "").toLowerCase());

    if (source.length >= 3 && lowered.slice(-3).join(" ") === "top or under") {
      return {
        nameTokens: source.slice(0, -3),
        mountTokens: source.slice(-3)
      };
    }

    const finalToken = lowered.at(-1);
    if (["—", "barrel", "top", "under"].includes(finalToken)) {
      return {
        nameTokens: source.slice(0, -1),
        mountTokens: source.slice(-1)
      };
    }

    return {
      nameTokens: source.slice(0, -1),
      mountTokens: source.slice(-1)
    };
  }

  findMatchingRow(name, rows) {
    const wanted = this.normalizeComparableName(name);
    if (!wanted) return null;

    const exact = rows.find((row) => row.normalizedName === wanted);
    if (exact) return exact;

    return rows.find((row) => row.normalizedName.includes(wanted) || wanted.includes(row.normalizedName)) ?? null;
  }

  normalizeComparableName(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  descriptionHtml(lines = []) {
    const text = lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return text ? `<p>${text}</p>` : "";
  }

  /**
   * Shadowrun 6 accessory prices use English-style thousands separators.
   * A leading plus sign, as in +500¥, is descriptive but the stored numeric
   * price remains 500.
   */
  parseCost(rawCost) {
    const original = String(rawCost ?? "").trim();
    if (!original) return { price: 0, priceDef: 0 };

    const withoutCurrency = original.replace(/¥/gu, "").trim();

    if (/[()x]/iu.test(withoutCurrency)) {
      return {
        price: 0,
        priceDef: original
      };
    }

    const normalizedNumber = withoutCurrency.replace(/[,+_\s]/gu, "");
    const value = Number(normalizedNumber);

    return {
      price: Number.isFinite(value) ? Math.abs(value) : 0,
      priceDef: original
    };
  }

  toFoundryItem({ name, description = "", row = null, warnings = [] } = {}) {
    const parsedCost = this.parseCost(row?.cost);
    const mountNote = row?.mount ? `<p><strong>Mount:</strong> ${row.mount}</p>` : "";
    const finalDescription = [description ?? "", mountNote].filter(Boolean).join("");

    return {
      name: name || row?.name || "Unnamed Accessory",
      type: "mod",
      img: "systems/shadowrun6-eden/icons/compendium/black-chrome/explicit-memory-stimulator.svg",
      system: {
        description: finalDescription,
        availDef: row?.availability ?? "",
        price: parsedCost.price,
        page: null,
        embeddedInUuid: null,
        type: this.modType
      },
      effects: [],
      folder: this.folderId ?? null,
      flags: {
        "shadowrun-items-importer": {
          sourceParser: this.constructor.name,
          tableRow: row,
          mount: row?.mount ?? "",
          priceDef: parsedCost.priceDef,
          warnings
        }
      }
    };
  }
}
