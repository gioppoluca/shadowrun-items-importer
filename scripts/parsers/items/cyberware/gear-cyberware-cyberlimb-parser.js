import { BaseCyberwareParser } from "./base-cyberware-parser.js";

export class GearCyberwareCyberlimbParser extends BaseCyberwareParser {
  static ITEM_TYPE = "gear.CYBERWARE.CYBER_LIMBS";

  getCyberwareSubtype() {
    return "CYBER_LIMBS";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const header = this.findCyberlimbHeader(lines);
    if (!header) return [];

    const beforeHeader = lines.slice(0, header.startIndex);
    const parsedTable = this.parseCyberlimbTableWithRemainder(lines.slice(header.endIndex + 1));
    const rows = parsedTable.rows;
    const descriptionSourceLines = this.combineDescriptionSources(beforeHeader, parsedTable.remainingLines);
    const { sections, generalDescriptionLines } = this.parseDescriptionSections(descriptionSourceLines, rows);

    const items = [];
    const warnings = [];
    const generatedRows = new Set();

    if (!rows.length) {
      warnings.push("No cyberlimb rows found after the cyberlimb table header. Check the pasted table format.");
    }

    for (const section of sections) {
      const matchingRows = this.findRowsForSection(section.name, rows);
      if (!matchingRows.length) {
        warnings.push(`Cyberware cyberlimb table row not found for "${section.name}". No items were created for that entry.`);
        continue;
      }

      for (const row of matchingRows) {
        generatedRows.add(row);
        items.push(...this.expandCyberwareItem({
          baseName: section.name,
          descriptionLines: this.mergeDescriptionLines(generalDescriptionLines, section.descriptionLines),
          row
        }));
      }
    }

    // Cyberlimb blocks are often pasted as a pure table. Create all valid rows
    // even when no individual description section is available.
    for (const row of rows) {
      if (generatedRows.has(row)) continue;

      items.push(...this.expandCyberwareItem({
        baseName: this.cleanCyberwareName(row.name),
        descriptionLines: generalDescriptionLines,
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

  findCyberlimbHeader(lines = []) {
    for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
      const firstLine = String(lines[startIndex] ?? "").trim();
      if (!this.looksLikeCyberlimbHeaderPart(firstLine)) continue;

      let headerText = "";
      for (let endIndex = startIndex; endIndex < Math.min(lines.length, startIndex + 8); endIndex += 1) {
        const part = String(lines[endIndex] ?? "").trim();
        if (!this.looksLikeCyberlimbHeaderPart(part)) break;

        headerText = `${headerText} ${part}`.replace(/\s+/g, " ").trim();
        if (this.isCyberlimbHeaderText(headerText)) {
          return { startIndex, endIndex, text: headerText };
        }
      }
    }

    return null;
  }

  looksLikeCyberlimbHeaderPart(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!normalized) return false;

    const headerTokenMatches = [
      /\bLIMB\b/u.test(normalized),
      /\bESSENCE\b/u.test(normalized),
      /\bAVAIL\b/u.test(normalized),
      /\bSYNTHETIC\b/u.test(normalized),
      /\bOBVIOUS\b/u.test(normalized),
      /\bCOST\b/u.test(normalized),
      /\bCAPACITY\b/u.test(normalized)
    ];
    const tokenCount = headerTokenMatches.filter(Boolean).length;

    // A split PDF header may contain a standalone "LIMB" line, but descriptive
    // text such as "Cyberlimbs replace a natural limb..." must not be consumed
    // as part of the table header.
    return normalized === "LIMB" || tokenCount >= 2;
  }

  isCyberlimbHeaderText(text) {
    const normalized = String(text ?? "").toUpperCase().replace(/\s+/g, " ").trim();

    return /\bLIMB\b/u.test(normalized)
      && normalized.includes("ESSENCE")
      && normalized.includes("AVAIL")
      && normalized.includes("SYNTHETIC")
      && normalized.includes("OBVIOUS")
      && normalized.includes("COST")
      && normalized.includes("CAPACITY");
  }

  combineDescriptionSources(beforeHeader = [], afterTable = []) {
    const before = beforeHeader.map((line) => String(line ?? "").trim()).filter(Boolean);
    const after = afterTable.map((line) => String(line ?? "").trim()).filter(Boolean);

    if (before.length && after.length) return [...before, "---", ...after];
    return before.length ? before : after;
  }


  mergeDescriptionLines(generalDescriptionLines = [], sectionDescriptionLines = []) {
    const general = generalDescriptionLines.map((line) => String(line ?? "").trim()).filter(Boolean);
    const section = sectionDescriptionLines.map((line) => String(line ?? "").trim()).filter(Boolean);
    return [...general, ...section];
  }

  isCyberlimbFamilyHeading(line) {
    const normalized = this.normalizeMatchName(line);
    return normalized === "cyberlimb" || normalized === "cyberlimbs";
  }

  parseDescriptionSections(lines = [], rows = []) {
    const sections = [];
    const generalDescriptionLines = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      sections.push(current);
      current = null;
    };

    for (const line of lines) {
      const clean = String(line ?? "").trim();
      if (!clean || clean === "---" || this.isCyberlimbFamilyHeading(clean)) {
        if (clean === "---") flush();
        continue;
      }

      const matchingRows = this.findRowsForSection(clean, rows);
      if (matchingRows.length) {
        flush();
        current = { name: clean, descriptionLines: [] };
        continue;
      }

      if (current) {
        current.descriptionLines.push(clean);
      } else {
        generalDescriptionLines.push(clean);
      }
    }

    flush();
    return { sections, generalDescriptionLines };
  }

  parseCyberlimbTableWithRemainder(lines = []) {
    const rows = [];
    let consumed = 0;
    let startedRows = false;

    for (let index = 0; index < lines.length; index += 1) {
      const clean = String(lines[index] ?? "").trim();
      if (!clean) {
        consumed = index + 1;
        continue;
      }

      if (this.looksLikeCyberlimbHeaderPart(clean) && !this.parseCyberlimbRow(clean).length) {
        consumed = index + 1;
        continue;
      }

      const rowVariants = this.parseCyberlimbRow(clean);
      if (!rowVariants.length) {
        if (startedRows) break;
        continue;
      }

      rows.push(...rowVariants);
      startedRows = true;
      consumed = index + 1;
    }

    return {
      rows,
      remainingLines: lines.slice(consumed)
    };
  }

  parseCyberlimbRow(rawRow) {
    const row = String(rawRow ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!row) return [];

    const syntheticMatch = this.matchTrailingCostCapacity(row);
    if (!syntheticMatch) return [];

    const obviousMatch = this.matchTrailingCostCapacity(syntheticMatch.before);
    if (!obviousMatch) return [];

    // The table columns are:
    // LIMB ESSENCE AVAIL SYNTHETIC COST (CAPACITY) OBVIOUS COST (CAPACITY)
    // When parsed from the right, the first matched cost/capacity is obvious,
    // and the second one is synthetic.
    const left = obviousMatch.before.trim();
    const synthetic = obviousMatch.costCapacity;
    const obvious = syntheticMatch.costCapacity;

    const leftMatch = left.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:\([A-Z]+\))?|—|-)$/iu);
    if (!leftMatch) return [];

    const base = {
      raw: row,
      baseName: leftMatch[1].trim(),
      essence: leftMatch[2].trim(),
      availability: leftMatch[3].trim()
    };

    return [
      this.toCyberlimbVariantRow(base, "Synthetic", synthetic),
      this.toCyberlimbVariantRow(base, "Obvious", obvious)
    ];
  }

  matchTrailingCostCapacity(text) {
    const source = String(text ?? "").trim();
    const match = source.match(/^(.*?)(\d[\d,]*(?:\.\d+)?\s*¥?)\s*\(\s*(\d+)\s*\)\s*$/u);
    if (!match) return null;

    return {
      before: match[1].trim(),
      costCapacity: {
        cost: match[2].trim().endsWith("¥") ? match[2].trim() : `${match[2].trim()}¥`,
        capacity: match[3].trim()
      }
    };
  }

  toCyberlimbVariantRow(base, variant, costCapacity) {
    return {
      raw: base.raw,
      name: `${base.baseName} (${variant})`,
      baseName: base.baseName,
      cyberlimbVariant: variant,
      essence: base.essence,
      capacity: costCapacity.capacity,
      availability: base.availability,
      cost: costCapacity.cost
    };
  }

  expandCyberwareItem({ baseName, descriptionLines, row }) {
    const items = super.expandCyberwareItem({ baseName, descriptionLines, row });

    for (const item of items) {
      item.system.notes = this.buildCyberlimbNotes(row);
      item.flags["shadowrun-items-importer"] = {
        ...(item.flags["shadowrun-items-importer"] ?? {}),
        tableRow: row,
        cyberlimb: {
          limb: row?.baseName ?? "",
          variant: row?.cyberlimbVariant ?? "",
          capacity: Number(row?.capacity) || 0
        }
      };
    }

    return items;
  }

  buildCyberwareName(baseName, rating, grade) {
    const gradePart = grade.label ? ` - ${grade.label}` : "";
    return `${this.cleanCyberwareName(baseName)}${gradePart}`;
  }

  buildDescription(descriptionLines = [], row = null, grade = null, rating = 0) {
    const base = super.buildDescription(descriptionLines, row, grade, rating);
    if (!row) return base;

    return `${base}<p><strong>Limb:</strong> ${row.baseName}</p><p><strong>Variant:</strong> ${row.cyberlimbVariant}</p>`;
  }

  buildCyberlimbNotes(row) {
    if (!row) return "";
    return `Limb: ${row.baseName}; Variant: ${row.cyberlimbVariant}; Capacity: ${row.capacity}`;
  }

  findRowsForSection(sectionName, rows = []) {
    const wanted = this.normalizeMatchName(sectionName);
    if (!wanted) return [];

    const exact = rows.filter((row) => this.normalizeMatchName(this.cleanCyberwareName(row.name)) === wanted);
    if (exact.length) return exact;

    const exactBase = rows.filter((row) => this.normalizeMatchName(row.baseName) === wanted);
    if (exactBase.length) return exactBase;

    const startsWithSection = rows.filter((row) => this.normalizeMatchName(this.cleanCyberwareName(row.name)).startsWith(wanted));
    if (startsWithSection.length) return startsWithSection;

    return rows.filter((row) => wanted.startsWith(this.normalizeMatchName(this.cleanCyberwareName(row.name)))
      || wanted.startsWith(this.normalizeMatchName(row.baseName)));
  }

  cleanCyberwareName(name) {
    return String(name ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  normalizeMatchName(name) {
    return String(name ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/gi, "")
      .trim();
  }
}
