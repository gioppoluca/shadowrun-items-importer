import { BaseCyberwareParser } from "./base-cyberware-parser.js";

export class GearCyberwareCyberjackParser extends BaseCyberwareParser {
  static ITEM_TYPE = "gear.CYBERWARE.CYBERJACK";

  getCyberwareSubtype() {
    return "CYBERJACK";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const header = this.findCyberjackHeader(lines);
    if (!header) {
      return [];
    }

    const baseName = this.extractCyberjackBaseName(header.text);
    const parsedTable = this.parseCyberjackRows(lines.slice(header.endIndex + 1));
    const descriptionLines = this.extractDescriptionLines({
      beforeHeader: lines.slice(0, header.startIndex),
      afterRows: parsedTable.remainingLines,
      baseName
    });

    const items = [];
    const warnings = [];

    if (!parsedTable.rows.length) {
      warnings.push("No cyberjack rows found after the cyberjack table header. Check the pasted table format.");
    }

    for (const row of parsedTable.rows) {
      items.push(...this.expandCyberwareItem({
        baseName,
        descriptionLines,
        row
      }));
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

  findCyberjackHeader(lines = []) {
    for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
      const firstLine = String(lines[startIndex] ?? "").trim();
      if (!this.looksLikeCyberjackHeaderPart(firstLine)) continue;

      let headerText = "";
      for (let endIndex = startIndex; endIndex < Math.min(lines.length, startIndex + 8); endIndex += 1) {
        const part = String(lines[endIndex] ?? "").trim();
        if (!this.looksLikeCyberjackHeaderPart(part)) break;

        headerText = `${headerText} ${part}`.replace(/\s+/g, " ").trim();
        if (this.isCyberjackHeaderText(headerText)) {
          return { startIndex, endIndex, text: headerText };
        }
      }
    }

    return null;
  }

  looksLikeCyberjackHeaderPart(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!normalized) return false;

    return /\bCYBERJACKS?\b/u.test(normalized)
      || normalized.includes("ATTRIBUTES")
      || normalized === "D/F"
      || normalized === "(D/F)"
      || normalized.includes("MATRIX")
      || normalized === "INIT"
      || normalized === "BONUS"
      || normalized.includes("AVAIL")
      || /\bESS\b/u.test(normalized)
      || normalized.includes("COST");
  }

  isCyberjackHeaderText(text) {
    const normalized = String(text ?? "").toUpperCase().replace(/\s+/g, " ").trim();

    return /\bCYBERJACKS?\b/u.test(normalized)
      && normalized.includes("ATTRIBUTES")
      && normalized.includes("D/F")
      && normalized.includes("MATRIX")
      && normalized.includes("INIT")
      && normalized.includes("BONUS")
      && normalized.includes("AVAIL")
      && /\bESS\b/u.test(normalized)
      && normalized.includes("COST");
  }

  extractCyberjackBaseName(headerText) {
    const beforeAttributes = String(headerText ?? "")
      .replace(/\s+/g, " ")
      .split(/\bATTRIBUTES\b/iu)[0]
      .trim();

    const name = beforeAttributes || "Cyberjack";
    return this.toTitleCase(this.singularizeCyberjackName(name));
  }

  parseCyberjackRows(lines = []) {
    const rows = [];
    let buffer = [];
    let consumed = 0;
    let startedRows = false;

    const flush = () => {
      const rawRow = buffer.join(" ").replace(/\s+/g, " ").trim();
      buffer = [];
      if (!rawRow) return false;

      const row = this.parseCyberjackRow(rawRow);
      if (!row) return false;

      rows.push(row);
      return true;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const clean = String(lines[index] ?? "").trim();
      if (!clean) {
        if (buffer.length) break;
        consumed = index + 1;
        continue;
      }

      if (this.looksLikeHeaderFragment(clean)) {
        consumed = index + 1;
        continue;
      }

      if (!buffer.length && !/^Rating\s+\d+\b/iu.test(clean)) {
        break;
      }

      startedRows = true;
      buffer.push(clean);

      if (/¥\s*$/u.test(clean)) {
        if (!flush()) break;
        consumed = index + 1;
      }
    }

    if (buffer.length && flush()) {
      consumed = lines.length;
    }

    return {
      rows,
      remainingLines: startedRows ? lines.slice(consumed) : lines
    };
  }

  looksLikeHeaderFragment(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    return normalized === "CYBERJACK"
      || normalized === "CYBERJACKS"
      || normalized === "ATTRIBUTES (D/F)"
      || normalized === "ATTRIBUTES"
      || normalized === "MATRIX INIT BONUS"
      || normalized === "MATRIX INIT"
      || normalized === "BONUS"
      || normalized === "AVAIL ESS COST"
      || normalized === "ESS COST"
      || normalized === "COST";
  }

  parseCyberjackRow(rawRow) {
    const row = String(rawRow ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!row) return null;

    const availabilityPattern = String.raw`(?:\d+(?:\([A-Z]+\))?|—|-)`;
    const essencePattern = String.raw`(?:\d+(?:[.,]\d+)?|—|-)`;
    const regex = new RegExp(
      String.raw`^Rating\s+(\d+)\s+(\d+\s*\/\s*\d+)\s+([+-]?\d+)\s+(${availabilityPattern})\s+(${essencePattern})\s+(.+?¥)\s*$`,
      "iu"
    );

    const match = row.match(regex);
    if (!match) return null;

    const [d, f] = match[2]
      .split("/")
      .map((value) => this.extractFirstInteger(value, 0));

    const rating = Number(match[1]) || 0;

    return {
      raw: row,
      name: "Cyberjack",
      rating,
      d,
      f,
      attributes: `${d}/${f}`,
      matrixInitBonus: this.extractFirstInteger(match[3], 0),
      availability: match[4].trim(),
      essence: match[5].trim(),
      capacity: "0",
      cost: match[6].trim()
    };
  }

  extractDescriptionLines({ beforeHeader = [], afterRows = [], baseName = "Cyberjack" } = {}) {
    const candidateLines = [...beforeHeader, ...afterRows]
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .filter((line) => !this.isCyberjackHeaderText(line))
      .filter((line) => !this.parseCyberjackRow(line));

    if (!candidateLines.length) return [];

    const first = candidateLines[0];
    const normalizedFirst = this.normalizeComparableName(this.singularizeCyberjackName(first));
    const normalizedBase = this.normalizeComparableName(this.singularizeCyberjackName(baseName));

    if (normalizedFirst === normalizedBase) {
      return candidateLines.slice(1);
    }

    return candidateLines;
  }

  expandCyberwareItem({ baseName, descriptionLines, row }) {
    const items = super.expandCyberwareItem({ baseName, descriptionLines, row });

    for (const item of items) {
      item.system.d = row?.d ?? 0;
      item.system.f = row?.f ?? 0;
      item.system.notes = this.buildCyberjackNotes(row);
      item.effects = [this.buildMatrixInitiativeActiveEffect(item.name, row)];
      item.flags["shadowrun-items-importer"] = {
        ...(item.flags["shadowrun-items-importer"] ?? {}),
        sourceParser: this.constructor.name,
        tableRow: row,
        cyberjack: {
          attributes: row?.attributes ?? "0/0",
          d: row?.d ?? 0,
          f: row?.f ?? 0,
          matrixInitBonus: row?.matrixInitBonus ?? 0
        }
      };
    }

    return items;
  }

  buildDescription(descriptionLines = [], row = null, grade = null, rating = 0) {
    const base = super.buildDescription(descriptionLines, row, grade, rating);
    if (!row) return base;

    const matrixStats = [
      `<p><strong>Attributes (D/F):</strong> ${row.attributes}</p>`,
      `<p><strong>Matrix Init Bonus:</strong> ${this.formatSigned(row.matrixInitBonus)}</p>`
    ];

    return `${base}${matrixStats.join("")}`;
  }

  buildCyberjackNotes(row) {
    if (!row) return "";
    return `Attributes (D/F): ${row.attributes}; Matrix Init Bonus: ${this.formatSigned(row.matrixInitBonus)}`;
  }

  buildMatrixInitiativeActiveEffect(itemName, row) {
    const matrixInitBonus = Number(row?.matrixInitBonus) || 0;

    return {
      name: itemName || "Cyberjack",
      img: "systems/shadowrun6-eden/icons/compendium/cyberware/memory_chip.svg",
      type: "base",
      system: {
        level: 1,
        advanced: false
      },
      changes: [
        {
          key: "system.initiative.matrix.mod",
          mode: 2,
          value: String(matrixInitBonus),
          priority: null
        }
      ],
      disabled: false,
      duration: {
        startTime: null,
        combat: null,
        seconds: null,
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null
      },
      description: `<p><strong>Matrix Init Bonus:</strong> ${this.formatSigned(matrixInitBonus)}</p>`,
      tint: "#ffffff",
      transfer: true,
      statuses: [],
      sort: 0,
      flags: {}
    };
  }

  formatSigned(value) {
    const number = Number(value) || 0;
    return number > 0 ? `+${number}` : String(number);
  }

  singularizeCyberjackName(name) {
    return String(name ?? "")
      .replace(/\bCyberjacks\b/giu, "Cyberjack")
      .replace(/\bCYBERJACKS\b/gu, "CYBERJACK")
      .trim();
  }

  toTitleCase(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
      .replace(/\s+/g, " ")
      .trim();
  }

  normalizeComparableName(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
