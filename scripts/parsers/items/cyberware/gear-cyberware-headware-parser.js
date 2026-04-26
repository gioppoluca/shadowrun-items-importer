import { BaseCyberwareParser } from "./base-cyberware-parser.js";

export class GearCyberwareHeadwareParser extends BaseCyberwareParser {
  static ITEM_TYPE = "gear.CYBERWARE.CYBER_HEADWARE";

  getCyberwareSubtype() {
    return "CYBER_HEADWARE";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const headerIndex = lines.findIndex((line) => this.isHeadwareHeader(line));
    const textLines = headerIndex >= 0 ? lines.slice(0, headerIndex) : lines;
    const tableLines = headerIndex >= 0 ? lines.slice(headerIndex + 1) : [];

    const sections = this.parseDescriptionSections(textLines);
    const rows = this.parseHeadwareTable(tableLines);
    const items = [];
    const warnings = [];

    for (const section of sections) {
      const row = this.findBestRow(section.name, rows);
      if (!row) {
        warnings.push(`Cyberware table row not found for "${section.name}". No items were created for that entry.`);
        continue;
      }

      items.push(...this.expandCyberwareItem({
        baseName: section.name,
        descriptionLines: section.descriptionLines,
        row
      }));
    }

    if (!items.length && rows.length) {
      // Skeleton-friendly fallback: when the user pastes only the table, create
      // all rows with empty descriptions. This is useful while implementing new
      // cyberware families incrementally.
      for (const row of rows) {
        items.push(...this.expandCyberwareItem({
          baseName: this.cleanCyberwareName(row.name),
          descriptionLines: [],
          row
        }));
      }
    }

    if (warnings.length) {
      for (const item of items) {
        item.flags["shadowrun-items-importer"] = {
          ...(item.flags["shadowrun-items-importer"] ?? {}),
          warnings
        };
      }
    }

    return items;
  }

  isHeadwareHeader(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    return normalized.includes("HEADWARE")
      && normalized.includes("ESSENCE")
      && normalized.includes("CAPACITY")
      && normalized.includes("AVAIL")
      && normalized.includes("COST");
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
      } else {
        current.push(line);
      }
    }

    flush();
    return sections;
  }

  parseHeadwareTable(lines = []) {
    const rows = [];
    const logicalRows = this.coalesceTableRows(lines);

    for (const rawRow of logicalRows) {
      const row = this.parseHeadwareRow(rawRow);
      if (row) rows.push(row);
    }

    return rows;
  }

  coalesceTableRows(lines = []) {
    const rows = [];
    let buffer = [];

    const flush = () => {
      const row = buffer.join(" ").replace(/\s+/g, " ").trim();
      buffer = [];
      if (row) rows.push(row);
    };

    for (const line of lines) {
      const clean = String(line ?? "").trim();
      if (!clean) continue;

      buffer.push(clean);

      // Headware rows usually end with a nuyen value or with an added required
      // device after the nuyen value, e.g. "2,000¥ + Commlink". Rating formula
      // rows also still contain ¥, so currency is the safest row terminator.
      if (/¥(?:\s*\+\s*.+)?\s*$/u.test(clean)) {
        flush();
      }
    }

    flush();
    return rows;
  }

  parseHeadwareRow(rawRow) {
    const row = String(rawRow ?? "").replace(/\s+/g, " ").trim();
    if (!row) return null;

    const availabilityPattern = String.raw`(?:\d+(?:\([LI]\))?|—|-)`;
    const capacityPattern = String.raw`(?:\[\d+\]|—|-)`;
    const essencePattern = String.raw`(?:(?:Rating\s*x\s*)?\d+(?:\.\d+)?|—|-)`;

    const regex = new RegExp(
      String.raw`^(.+?)\s+(${essencePattern})\s+(${capacityPattern})\s+(${availabilityPattern})\s+(.+)$`,
      "iu"
    );

    const match = row.match(regex);
    if (!match) return null;

    return {
      raw: row,
      name: match[1].trim(),
      essence: match[2].trim(),
      capacity: match[3].trim(),
      availability: match[4].trim(),
      cost: match[5].trim()
    };
  }

  findBestRow(sectionName, rows = []) {
    const wanted = this.normalizeMatchName(sectionName);
    if (!wanted) return null;

    return rows.find((row) => this.normalizeMatchName(this.cleanCyberwareName(row.name)) === wanted)
      ?? rows.find((row) => this.normalizeMatchName(this.cleanCyberwareName(row.name)).startsWith(wanted))
      ?? rows.find((row) => wanted.startsWith(this.normalizeMatchName(this.cleanCyberwareName(row.name))));
  }

  normalizeMatchName(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
