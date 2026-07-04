import { BaseCyberwareParser } from "./base-cyberware-parser.js";

export class GearCyberwareEarwareParser extends BaseCyberwareParser {
  static ITEM_TYPE = "gear.CYBERWARE.CYBER_EARWARE";

  getCyberwareSubtype() {
    return "CYBER_EARWARE";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const headerIndex = lines.findIndex((line) => this.isEarwareHeader(line));
    const beforeHeader = headerIndex >= 0 ? lines.slice(0, headerIndex) : [];
    const afterHeader = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;

    const parsedTable = this.parseEarwareTableWithRemainder(afterHeader);
    const descriptionSourceLines = this.combineDescriptionSources(beforeHeader, parsedTable.remainingLines);
    const sections = this.parseDescriptionSections(descriptionSourceLines);
    const rows = parsedTable.rows;
    const items = [];
    const warnings = [];
    const generatedRows = new Set();

    for (const section of sections) {
      const matchingRows = this.findRowsForSection(section.name, rows);
      if (!matchingRows.length) {
        warnings.push(`Cyberware earware table row not found for "${section.name}". No items were created for that entry.`);
        continue;
      }

      for (const row of matchingRows) {
        generatedRows.add(row);
        items.push(...this.expandCyberwareItem({
          baseName: section.name,
          descriptionLines: section.descriptionLines,
          row
        }));
      }
    }

    // Earware source text is often pasted as a full table followed by only the
    // currently selected descriptions. Do not silently drop valid table rows:
    // create the unmatched rows with an empty description, while using the
    // pasted descriptions where they are available.
    for (const row of rows) {
      if (generatedRows.has(row)) continue;

      items.push(...this.expandCyberwareItem({
        baseName: this.cleanCyberwareName(row.name),
        descriptionLines: [],
        row
      }));
    }

    for (const item of items) {
      item.flags["shadowrun-items-importer"] = {
        ...(item.flags["shadowrun-items-importer"] ?? {}),
        sourceParser: this.constructor.name
      };
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

  isEarwareHeader(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    return normalized.includes("EARWARE")
      && normalized.includes("ESSENCE")
      && normalized.includes("CAPACITY")
      && normalized.includes("AVAIL")
      && normalized.includes("COST");
  }

  combineDescriptionSources(beforeHeader = [], afterTable = []) {
    const before = beforeHeader.map((line) => String(line ?? "").trim()).filter(Boolean);
    const after = afterTable.map((line) => String(line ?? "").trim()).filter(Boolean);

    if (before.length && after.length) return [...before, "---", ...after];
    return before.length ? before : after;
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

  parseEarwareTableWithRemainder(lines = []) {
    const rows = [];
    let currentBasicSystemName = null;
    let buffer = [];
    let consumed = 0;

    const flush = () => {
      const rawRow = buffer.join(" ").replace(/\s+/g, " ").trim();
      buffer = [];
      if (!rawRow) return false;

      const row = this.parseEarwareRow(rawRow, currentBasicSystemName);
      if (!row) return false;

      if (row.basicSystemParentName) {
        currentBasicSystemName = row.basicSystemParentName;
      }

      rows.push(row);
      return true;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const clean = String(lines[index] ?? "").trim();
      if (!clean) {
        consumed = index + 1;
        continue;
      }

      if (!buffer.length && rows.length && !this.canStartOrContinueEarwareRow(clean)) {
        break;
      }

      buffer.push(clean);

      if (/¥(?:\s*\+\s*.+)?\s*$/u.test(clean)) {
        const parsed = flush();
        if (!parsed) break;
        consumed = index + 1;
      }
    }

    if (buffer.length) {
      const parsed = flush();
      if (parsed) consumed = lines.length;
    }

    return {
      rows,
      remainingLines: lines.slice(consumed)
    };
  }

  canStartOrContinueEarwareRow(line) {
    const normalized = String(line ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) return false;

    return /^Rating\s+\d+\b/iu.test(normalized)
      || /\bbasic\s+system\b/iu.test(normalized)
      || /¥/u.test(normalized)
      || /\(\s*Rating\b/iu.test(normalized)
      || /\[\s*(?:Rating|\d+)\s*\]/iu.test(normalized)
      || /^\d+(?:[.,]\d+)?\s+(?:\[\s*(?:Rating|\d+)\s*\]|\d+|—|-)/iu.test(normalized);
  }

  parseEarwareRow(rawRow, currentBasicSystemName = null) {
    const row = String(rawRow ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!row) return null;

    const availabilityPattern = String.raw`(?:\d+(?:\([LI]\))?|—|-)`;
    const capacityPattern = String.raw`(?:\[\s*(?:Rating|\d+)\s*\]|\d+|—|-)`;
    const essencePattern = String.raw`(?:(?:Rating\s*x\s*)?\d+(?:[.,]\d+)?|—|-)`;

    // Generic basic-system support:
    //   Cyberears basic system
    //   Rating 1 0.1 1 2 1,000¥
    // may arrive as one logical row after coalescing. The label before
    // "basic system" is used as the item name; following Rating rows reuse it.
    const basicSystemRegex = new RegExp(
      String.raw`^(?:(.+?\bbasic\s+system\b)\s+)?Rating\s+(\d+)\s+(${essencePattern})\s+(${capacityPattern})\s+(${availabilityPattern})\s+(.+)$`,
      "iu"
    );

    const basicMatch = row.match(basicSystemRegex);
    if (basicMatch) {
      const printedParentName = basicMatch[1]?.trim() ?? currentBasicSystemName;
      if (!printedParentName) return null;

      return {
        raw: row,
        name: this.cleanBasicSystemName(printedParentName),
        rating: Number(basicMatch[2]),
        basicSystemParentName: printedParentName,
        essence: basicMatch[3].trim(),
        capacity: basicMatch[4].trim(),
        availability: basicMatch[5].trim(),
        cost: basicMatch[6].trim()
      };
    }

    const normalRegex = new RegExp(
      String.raw`^(.+?)\s+(${essencePattern})\s+(${capacityPattern})\s+(${availabilityPattern})\s+(.+)$`,
      "iu"
    );

    const match = row.match(normalRegex);
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

  findRowsForSection(sectionName, rows = []) {
    const wanted = this.normalizeMatchName(sectionName);
    if (!wanted) return [];

    const exact = rows.filter((row) => this.normalizeMatchName(this.cleanCyberwareName(row.name)) === wanted);
    if (exact.length) return exact;

    const startsWithSection = rows.filter((row) => this.normalizeMatchName(this.cleanCyberwareName(row.name)).startsWith(wanted));
    if (startsWithSection.length) return startsWithSection;

    return rows.filter((row) => wanted.startsWith(this.normalizeMatchName(this.cleanCyberwareName(row.name))));
  }

  cleanBasicSystemName(name) {
    return String(name ?? "")
      .replace(/\bbasic\s+system\b/iu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  normalizeMatchName(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/\bbasic\s+system\b/iu, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
