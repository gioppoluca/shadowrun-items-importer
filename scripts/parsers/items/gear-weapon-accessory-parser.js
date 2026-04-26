import { BaseItemParser } from "./base-item-parser.js";

/**
 * Parser for Shadowrun 6 Eden weapon accessory gear blocks.
 *
 * The source text follows the same shape as weapon imports:
 *   1. one or more requested accessory blocks, optionally separated by "---"
 *   2. a shared table containing many accessories
 *
 * Example:
 *   Spare clip
 *   description...
 *   ---
 *   Speed loader
 *   description...
 *
 *   ACCESSORY MOUNT AVAILABILITY COST
 *   Spare clip — 2 5¥
 *   Speed loader — 1 25¥
 *
 * We parse the shared table once and create only the requested accessories.
 * Table rows are collected until a token ending in "¥" so wrapped rows remain
 * safe. The ACCESSORY table does not have fixed-width columns; therefore the
 * parser works backwards from COST and AVAILABILITY, then interprets the text
 * between accessory name and availability as the mount.
 */
export class GearWeaponAccessoryParser extends BaseItemParser {
  constructor({ text, type, folderId }) {
    super({ text, type, folderId });
    this.modType = "weapon_mod";
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
    const tableLines = lines.slice(headerIndex + 1);
    const requestedBlocks = this.parseRequestedAccessoryBlocks(introLines);
    const tableRows = this.parseAccessoryRows(tableLines);

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
    return lines.findIndex((line) => /^ACCESSORY\s+MOUNT\s+AVAILABILITY\s+COST\b/i.test(line));
  }

  parseRequestedAccessoryBlocks(lines) {
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

    return blocks.length ? blocks : [{ name: "Unnamed Accessory", descriptionLines: [] }];
  }

  parseAccessoryRows(tableLines) {
    const rows = [];
    let buffer = [];

    for (const line of tableLines) {
      const cleaned = String(line ?? "").trim();
      if (!cleaned) continue;
      if (/^ACCESSORY\s+MOUNT\s+AVAILABILITY\s+COST\b/i.test(cleaned)) continue;

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
    const availability = tokens[availabilityIndex];
    const beforeAvailability = tokens.slice(0, availabilityIndex);

    const mountStartIndex = this.findMountStartIndex(beforeAvailability);
    const nameTokens = mountStartIndex >= 0 ? beforeAvailability.slice(0, mountStartIndex) : beforeAvailability.slice(0, -1);
    const mountTokens = mountStartIndex >= 0 ? beforeAvailability.slice(mountStartIndex) : beforeAvailability.slice(-1);

    const name = nameTokens.join(" ").trim();
    const mount = mountTokens.join(" ").trim();
    if (!name) return null;

    return {
      raw: normalized,
      name,
      normalizedName: this.normalizeComparableName(name),
      mount,
      availability,
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
    return /^(?:\d+|[-–—])(?:\([A-Z]\))?$/iu.test(String(token ?? ""));
  }

  findMountStartIndex(tokens) {
    const mountWords = new Set(["—", "barrel", "top", "under"]);

    for (let i = 0; i < tokens.length; i += 1) {
      const token = String(tokens[i] ?? "").toLowerCase();
      if (mountWords.has(token)) return i;
    }

    return -1;
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
   *
   * Examples:
   *   - 2,500¥ -> price 2500
   *   - +500¥ -> price 500, priceDef "+500¥" so the additive nature is visible
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

    const normalizedNumber = withoutCurrency.replace(/[,_\s]/gu, "");
    const value = Number(normalizedNumber);

    return {
      price: Number.isFinite(value) ? Math.abs(value) : 0,
      priceDef: Number.isFinite(value) ? original : original
    };
  }

  toFoundryItem({ name, description = "", row = null, warnings = [] } = {}) {
    const parsedCost = this.parseCost(row?.cost);

    const mountNote = row?.mount ? `<p><strong>Mount:</strong> ${row.mount}</p>` : "";
    //const importedRowNote = row?.raw ? `<p><strong>Imported table row:</strong> ${row.raw}</p>` : "";
    const notes = [mountNote].filter(Boolean).join("");

    /*
     * Shadowrun 6 Eden stores weapon accessories as Item type "mod", not as
     * gear. The relevant system type is "weapon_mod".
     *
     * The ACCESSORY table contains a Mount column, but the Eden mod template has
     * no dedicated mount field. We therefore preserve the mount in the rendered
     * description/notes and in module flags, while keeping the actual item shape
     * aligned with an exported gear-mod item.
     */
    const finalDescription = [description ?? "", notes].filter(Boolean).join("");

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