import { BaseCyberwareParser } from "./base-cyberware-parser.js";

export class GearCyberwareBodywareParser extends BaseCyberwareParser {
  static ITEM_TYPE = "gear.CYBERWARE.CYBER_BODYWARE";

  getCyberwareSubtype() {
    return "CYBER_BODYWARE";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const headerIndex = lines.findIndex((line) => this.isBodywareHeader(line));
    const textLines = headerIndex >= 0 ? lines.slice(0, headerIndex) : lines;
    const tableLines = headerIndex >= 0 ? lines.slice(headerIndex + 1) : [];

    const rows = this.parseBodywareTable(tableLines);
    const variantEffectTables = this.parseVariantEffectTables(textLines);
    this.applyVariantEffects(rows, variantEffectTables);

    const sections = this.parseDescriptionSections(textLines, rows);
    const items = [];
    const warnings = [];

    for (const section of sections) {
      const matchingRows = this.findRowsForSection(section.name, rows);
      if (!matchingRows.length) {
        warnings.push(`Cyberware bodyware table row not found for "${section.name}". No items were created for that entry.`);
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
      // Useful fallback while testing: a pasted BODYWARE table without
      // descriptions still creates the row-derived bodyware items.
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

  isBodywareHeader(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    return normalized.includes("BODYWARE")
      && normalized.includes("ESSENCE")
      && normalized.includes("CAPACITY")
      && normalized.includes("AVAIL")
      && normalized.includes("COST");
  }

  parseDescriptionSections(lines = [], rows = []) {
    const rowBaseNames = new Set(
      rows
        .map((row) => this.normalizeMatchName(this.cleanCyberwareName(row.name)))
        .filter(Boolean)
    );

    const sections = [];
    let current = null;
    let skippingEffectTable = false;

    const flush = () => {
      if (!current) return;
      sections.push(current);
      current = null;
    };

    for (const line of lines) {
      const clean = String(line ?? "").trim();
      if (!clean) continue;

      if (this.isVariantEffectHeader(clean)) {
        skippingEffectTable = true;
        continue;
      }

      if (skippingEffectTable) {
        if (this.parseVariantEffectRow(clean)) continue;
        skippingEffectTable = false;
      }

      const normalized = this.normalizeMatchName(clean);
      if (rowBaseNames.has(normalized)) {
        flush();
        current = { name: clean, descriptionLines: [] };
        continue;
      }

      if (!current) {
        current = { name: clean, descriptionLines: [] };
      } else {
        current.descriptionLines.push(clean);
      }
    }

    flush();
    return sections;
  }

  parseBodywareTable(lines = []) {
    const rows = [];
    const logicalRows = this.coalesceTableRows(lines);

    for (const rawRow of logicalRows) {
      const row = this.parseBodywareRow(rawRow);
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

      // Bodyware costs may end with ¥, but OCR/pasted tables sometimes lose it
      // (e.g. "Rating x 4,500"). Since bodyware rows are generally one printed
      // line, also flush on a trailing numeric cost.
      if (/¥\s*$/u.test(clean) || /\d\s*$/u.test(clean)) flush();
    }

    flush();
    return rows;
  }

  parseBodywareRow(rawRow) {
    const row = String(rawRow ?? "").replace(/\s+/g, " ").trim();
    if (!row) return null;

    const availabilityPattern = String.raw`(?:\d+(?:\([A-Z]+\))?|—|-)`;
    const capacityPattern = String.raw`(?:\[[^\]]+\]|\d+|—|-)`;

    // Parse from the right-hand side of the row. Cost, availability, capacity,
    // and essence are the stable columns; names can contain ratings, numbers,
    // and parenthetical variants such as "Bone Lacing (Plastic)".
    const anchored = row.match(new RegExp(String.raw`^(.+)\s+(${capacityPattern})\s+(${availabilityPattern})\s+(.+)$`, "iu"));
    if (!anchored) return null;

    const left = anchored[1].trim();
    const capacity = anchored[2].trim();
    const availability = anchored[3].trim();
    const cost = anchored[4].trim();

    const split = this.splitNameAndEssence(left);
    if (!split) return null;

    const ratingInfo = this.extractTrailingRating(split.name);

    return {
      raw: row,
      name: ratingInfo.name,
      rating: ratingInfo.rating,
      variant: this.extractParentheticalVariant(ratingInfo.name),
      essence: split.essence,
      capacity,
      availability,
      cost
    };
  }

  splitNameAndEssence(leftSide) {
    const text = String(leftSide ?? "").trim();
    if (!text) return null;

    const patterns = [
      // Examples: "Dermal Plating (Rating 1-4) Rating x .3"
      /^(?<name>.+?)\s+(?<essence>Rating\s*[×x]\s*\.?\d+(?:\.\d+)?)$/iu,
      // Examples: "Internal Air Tank (Rating 1-4) 0.25"
      /^(?<name>.+?)\s+(?<essence>\d+(?:\.\d+)?|\.\d+)$/iu,
      /^(?<name>.+?)\s+(?<essence>—|-)$/iu
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.groups?.name && match?.groups?.essence) {
        return {
          name: match.groups.name.trim(),
          essence: match.groups.essence.trim()
        };
      }
    }

    return null;
  }

  parseVariantEffectTables(lines = []) {
    const tables = [];
    let current = null;

    for (const line of lines) {
      const clean = String(line ?? "").trim();
      if (!clean) continue;

      if (this.isVariantEffectHeader(clean)) {
        current = [];
        tables.push(current);
        continue;
      }

      if (!current) continue;

      const parsed = this.parseVariantEffectRow(clean);
      if (parsed) {
        current.push(parsed);
      } else if (this.looksLikeSectionTitle(clean)) {
        current = null;
      }
    }

    return tables.flat();
  }

  isVariantEffectHeader(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    return normalized.includes("BODY")
      && normalized.includes("DEFENSE")
      && normalized.includes("UNARMED-DV")
      && normalized.includes("UNARMED-AR");
  }

  parseVariantEffectRow(line) {
    const clean = String(line ?? "").replace(/\s+/g, " ").trim();
    if (!clean) return null;

    const match = clean.match(/^(.+?)\s+([+-]?\d+)\s+([+-]?\d+)\s+(\d+[PS])\s+([+-]?\d+)$/iu);
    if (!match) return null;

    return {
      variant: match[1].trim(),
      body: Number(match[2]),
      defense: Number(match[3]),
      unarmedDv: match[4].trim(),
      unarmedAr: Number(match[5])
    };
  }

  applyVariantEffects(rows = [], effects = []) {
    if (!effects.length) return;

    for (const row of rows) {
      const variant = this.extractParentheticalVariant(row.name);
      if (!variant) continue;

      const effect = effects.find((candidate) => this.normalizeMatchName(candidate.variant) === this.normalizeMatchName(variant));
      if (effect) row.variantEffect = effect;
    }
  }

  expandCyberwareItem({ baseName, descriptionLines, row }) {
    const items = super.expandCyberwareItem({ baseName, descriptionLines, row });

    if (!row?.variantEffect) return items;

    for (const item of items) {
      item.effects = [this.buildVariantActiveEffect(item.name, row.variantEffect)];
    }

    return items;
  }

  buildVariantActiveEffect(itemName, variantEffect) {
    const changes = [];

    if (Number.isFinite(variantEffect.body) && variantEffect.body !== 0) {
      changes.push({ key: "system.attributes.bod.mod", mode: 2, value: String(variantEffect.body), priority: null });
    }

    if (Number.isFinite(variantEffect.defense) && variantEffect.defense !== 0) {
      changes.push({ key: "system.defenserating.physical.mod", mode: 2, value: String(variantEffect.defense), priority: null });
    }

    if (Number.isFinite(variantEffect.unarmedAr) && variantEffect.unarmedAr !== 0) {
      changes.push({ key: "system.attackrating.physical.mod", mode: 2, value: String(variantEffect.unarmedAr), priority: null });
    }

    return {
      name: itemName || "Active Effect",
      img: "systems/shadowrun6-eden/icons/compendium/cyberware/memory_chip.svg",
      type: "base",
      system: {
        level: 1,
        advanced: false
      },
      changes,
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
      description: variantEffect.unarmedDv
        ? `<p><strong>Unarmed DV:</strong> ${variantEffect.unarmedDv}</p>`
        : "",
      tint: "#ffffff",
      transfer: true,
      statuses: [],
      sort: 0,
      flags: {}
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

  extractParentheticalVariant(name) {
    const matches = [...String(name ?? "").matchAll(/\(([^)]+)\)/gu)];
    const variant = matches
      .map((match) => match[1].trim())
      .find((value) => !/^rating\s*\d+\s*[–-]\s*\d+$/iu.test(value));

    return variant ?? "";
  }

  extractTrailingRating(name) {
    const text = String(name ?? "").replace(/\s+/g, " ").trim();
    const match = text.match(/^(.*\S)\s+(\d+)$/u);
    if (!match) return { name: text, rating: 0 };

    // Parenthetical rating ranges are already handled by BaseCyberwareParser.
    // This branch covers printed rows such as "Wired Reflexes 1 2 — 5(R) ...",
    // where the trailing number before essence is the item rating/level.
    return {
      name: match[1].trim(),
      rating: Number(match[2]) || 0
    };
  }

  looksLikeSectionTitle(line) {
    const clean = String(line ?? "").trim();
    return /^[A-Z][A-Za-z0-9’' -]+$/u.test(clean) && clean.split(/\s+/u).length <= 6;
  }

  normalizeMatchName(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
