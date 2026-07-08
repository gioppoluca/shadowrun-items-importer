import { BaseCyberwareParser } from "./base-cyberware-parser.js";

export class GearCyberwareBodywareParser extends BaseCyberwareParser {
  static ITEM_TYPE = "gear.CYBERWARE.CYBER_BODYWARE";

  getCyberwareSubtype() {
    return "BIOWARE_STANDARD";
  }

  getGearType() {
    return "BIOWARE";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const headerIndex = lines.findIndex((line) => this.isBodywareHeader(line));
    const textLines = headerIndex >= 0 ? lines.slice(0, headerIndex) : lines;
    const tableLines = headerIndex >= 0 ? lines.slice(headerIndex + 1) : [];

    const parsedTable = this.parseBodywareTableWithRemainder(tableLines);
    const rows = parsedTable.rows;
    const descriptionSourceLines = this.combineDescriptionSources(textLines, parsedTable.remainingLines);

    const variantEffectTables = this.parseVariantEffectTables(descriptionSourceLines);
    this.applyVariantEffects(rows, variantEffectTables);

    const { sections, generalDescriptionLines } = this.parseDescriptionSections(descriptionSourceLines, rows);
    const items = [];
    const warnings = [];
    const generatedRows = new Set();

    for (const section of sections) {
      const matchingRows = this.findRowsForSection(section.name, rows);
      if (!matchingRows.length) {
        warnings.push(`Cyberware bodyware table row not found for "${section.name}". No items were created for that entry.`);
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

    if (rows.length) {
      // A pasted BODYWARE/BIOWARE table may have only generic prose, or only a
      // subset of item-specific sections. Preserve that textual part instead of
      // falling back to empty descriptions for the remaining rows.
      for (const row of rows) {
        if (generatedRows.has(row)) continue;
        if (items.length && !generalDescriptionLines.length) continue;

        items.push(...this.expandCyberwareItem({
          baseName: this.cleanCyberwareName(row.name),
          descriptionLines: generalDescriptionLines,
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
      && normalized.includes("AVAIL")
      && normalized.includes("COST")
      && (normalized.includes("CAPACITY") || normalized.includes("RATING"));
  }

  parseDescriptionSections(lines = [], rows = []) {
    const sections = [];
    const generalDescriptionLines = [];
    let current = null;
    let skippingEffectTable = false;

    const flush = () => {
      if (!current) return;
      sections.push(current);
      current = null;
    };

    for (const line of lines) {
      const clean = String(line ?? "").trim();
      if (!clean || clean === "---" || this.isBodywareFamilyHeading(clean)) {
        if (clean === "---") flush();
        continue;
      }

      if (this.isVariantEffectHeader(clean)) {
        flush();
        skippingEffectTable = true;
        continue;
      }

      if (skippingEffectTable) {
        if (this.parseVariantEffectRow(clean)) continue;
        skippingEffectTable = false;
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

  parseBodywareTable(lines = []) {
    const rows = [];
    const logicalRows = this.coalesceTableRows(lines);

    for (const rawRow of logicalRows) {
      const row = this.parseBodywareBiowareRow(rawRow) ?? this.parseBodywareRow(rawRow);
      if (row) rows.push(row);
    }

    return rows;
  }


  parseBodywareTableWithRemainder(lines = []) {
    const rows = [];
    let buffer = [];
    let consumed = 0;
    let startedRows = false;

    const parseBufferedRow = () => {
      const rawRow = buffer.join(" ").replace(/\s+/g, " ").trim();
      buffer = [];
      if (!rawRow) return null;
      return this.parseBodywareBiowareRow(rawRow) ?? this.parseBodywareRow(rawRow);
    };

    for (let index = 0; index < lines.length; index += 1) {
      const clean = String(lines[index] ?? "").trim();
      if (!clean) {
        if (!startedRows) consumed = index + 1;
        continue;
      }

      buffer.push(clean);

      // Bodyware/Bioware cost cells normally end in ¥. Some PDF/OCR pastes
      // lose that marker, so we also accept a trailing digit as the end of a
      // logical row. If that logical row stops parsing after rows have already
      // started, everything from that point is textual description, not table.
      if (!/¥\s*$/u.test(clean) && !/\d\s*$/u.test(clean)) continue;

      const row = parseBufferedRow();
      if (row) {
        rows.push(row);
        startedRows = true;
        consumed = index + 1;
        continue;
      }

      if (startedRows) break;
      consumed = index + 1;
    }

    if (buffer.length && !startedRows) {
      const row = parseBufferedRow();
      if (row) {
        rows.push(row);
        consumed = lines.length;
      }
    }

    return {
      rows,
      remainingLines: lines.slice(consumed)
    };
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

  isBodywareFamilyHeading(line) {
    const normalized = this.normalizeMatchName(line);
    return normalized === "bodyware"
      || normalized === "bioware"
      || normalized === "standard bioware"
      || normalized === "cultured bioware";
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


  parseBodywareBiowareRow(rawRow) {
    const row = String(rawRow ?? "").replace(/\s+/g, " ").trim();
    if (!row) return null;

    // New SR6 Bodyware/Bioware table shape:
    // BODYWARE RATING ESSENCE AVAILABILITY COST
    // Adrenaline pump 1–3 Rating x 0.75 5(I) Rating x 55,000¥
    const match = row.match(/^(.+?)\s+(n\/?a|\d+\s*[–-]\s*\d+)\s+((?:Rating\s*[×x]\s*)?\d+(?:\.\d+)?|(?:Rating\s*[×x]\s*)?\.\d+)\s+(\d+(?:\([A-Z]+\))?|—|-)\s+(.+)$/iu);
    if (!match) return null;

    const ratingColumn = match[2].trim();
    const ratingRange = this.parseRatingColumn(ratingColumn);
    const name = ratingRange
      ? `${match[1].trim()} (Rating ${ratingRange.min}-${ratingRange.max})`
      : match[1].trim();

    return {
      raw: row,
      name,
      rating: 0,
      variant: "",
      essence: match[3].trim(),
      capacity: "0",
      availability: match[4].trim(),
      cost: match[5].trim(),
      ratingColumn,
      ratingRange,
      bodywareKind: "bioware"
    };
  }

  parseRatingColumn(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized || /^n\/?a$/iu.test(normalized)) return null;

    const match = normalized.match(/^(\d+)\s*[–-]\s*(\d+)$/u);
    if (!match) return null;

    const min = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
    return { min, max };
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

    for (const item of items) {
      const effects = [];

      if (row?.variantEffect) {
        effects.push(this.buildVariantActiveEffect(item.name, row.variantEffect));
      }

      const boneDensityEffect = this.buildBoneDensityActiveEffect(item.name, row, item.system?.rating);
      if (boneDensityEffect) effects.push(boneDensityEffect);

      if (effects.length) item.effects = effects;
    }

    return items;
  }


  buildBoneDensityActiveEffect(itemName, row, rating) {
    const normalizedName = this.normalizeMatchName(this.cleanCyberwareName(row?.name ?? ""));
    if (normalizedName !== "bone density augmentation") return null;

    const ratingValue = Number(rating) || 0;
    const bonusByRating = {
      1: { dv: 1, ar: 1 },
      2: { dv: 1, ar: 2 },
      3: { dv: 2, ar: 2 },
      4: { dv: 2, ar: 3 }
    };
    const bonus = bonusByRating[ratingValue];
    if (!bonus) return null;

    return {
      name: itemName || "Bone density augmentation",
      img: "systems/shadowrun6-eden/icons/compendium/cyberware/memory_chip.svg",
      type: "base",
      system: {
        level: 1,
        advanced: false
      },
      changes: [
        { key: "system.attackrating.physical.mod", mode: 2, value: String(bonus.ar), priority: null },
        { key: "system.dmg", mode: 2, value: String(bonus.dv), priority: null }
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
      description: `<p><strong>Bone density augmentation:</strong> DV +${bonus.dv}, AR +${bonus.ar}</p>`,
      tint: "#ffffff",
      transfer: true,
      statuses: [],
      sort: 0,
      flags: {}
    };
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


  toCyberwareFoundryItem(data) {
    const item = super.toCyberwareFoundryItem(data);
    item.system.type = this.getGearType();
    item.system.subtype = this.getCyberwareSubtype();
    return item;
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
