import { BaseCyberwareParser } from "./base-cyberware-parser.js";

export class GearCyberwareEyewareParser extends BaseCyberwareParser {
  static ITEM_TYPE = "gear.CYBERWARE.CYBER_EYEWARE";

  getCyberwareSubtype() {
    return "CYBER_EYEWARE";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const headerIndex = lines.findIndex((line) => this.isEyewareHeader(line));
    const textLines = headerIndex >= 0 ? lines.slice(0, headerIndex) : lines;
    const tableLines = headerIndex >= 0 ? lines.slice(headerIndex + 1) : [];

    const sections = this.parseDescriptionSections(textLines);
    const rows = this.parseEyewareTable(tableLines);
    const items = [];
    const warnings = [];

    for (const section of sections) {
      const matchingRows = this.findRowsForSection(section.name, rows);
      if (!matchingRows.length) {
        warnings.push(`Cyberware eyeware table row not found for "${section.name}". No items were created for that entry.`);
        continue;
      }

      for (const row of matchingRows) {
        items.push(...this.expandCyberwareItem({
          baseName: section.name,
          descriptionLines: section.descriptionLines,
          row
        }));
      }
    }

    if (!items.length && rows.length) {
      // Useful fallback while testing: a pasted table without descriptions still
      // creates all eyeware rows.
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

  isEyewareHeader(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    return normalized.includes("EYEWARE")
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

  parseEyewareTable(lines = []) {
    const rows = [];
    const logicalRows = this.coalesceTableRows(lines);
    let currentBasicSystemName = null;

    for (const rawRow of logicalRows) {
      const row = this.parseEyewareRow(rawRow, currentBasicSystemName);
      if (!row) continue;

      if (row.basicSystemParentName) {
        currentBasicSystemName = row.basicSystemParentName;
      }

      rows.push(row);
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

      // Rows ending in currency are data rows. Lines without a currency marker
      // are either wrapped names or parent labels such as "Cybereyes basic
      // system". Keeping them in the buffer lets the following "Rating N ..."
      // row inherit that parent name without hard-coding Cybereyes.
      buffer.push(clean);
      if (/¥\s*$/u.test(clean)) flush();
    }

    flush();
    return rows;
  }

  parseEyewareRow(rawRow, currentBasicSystemName = null) {
    const row = String(rawRow ?? "").replace(/\s+/g, " ").trim();
    if (!row) return null;

    const availabilityPattern = String.raw`(?:\d+(?:\([LI]\))?|—|-)`;
    const capacityPattern = String.raw`(?:\[\d+\]|\d+|—|-)`;
    const essencePattern = String.raw`(?:(?:Rating\s*x\s*)?\d+(?:\.\d+)?|—|-)`;

    // Generic "basic system" support:
    //   Cybereyes basic system
    //   Rating 1 0.1 1 2 1,000¥
    // may arrive as one logical row after coalescing. The label before
    // "basic system" is used as the item name; the following Rating rows reuse
    // the same parent until another basic-system parent appears.
    const basicSystemRegex = new RegExp(
      String.raw`^(?:(.+?\bbasic\s+system\b)\s+)?Rating\s+(\d+)\s+(${essencePattern})\s+(${capacityPattern})\s+(${availabilityPattern})\s+(.+)$`,
      "iu"
    );

    const basicMatch = row.match(basicSystemRegex);
    if (basicMatch) {
      const printedParentName = basicMatch[1]?.trim() ?? currentBasicSystemName;
      if (!printedParentName) return null;

      const itemName = this.cleanBasicSystemName(printedParentName);
      const rating = Number(basicMatch[2]);

      return {
        raw: row,
        name: itemName,
        rating,
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
