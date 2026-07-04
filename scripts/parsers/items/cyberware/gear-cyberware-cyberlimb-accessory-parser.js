import { BaseItemParser } from "../base-item-parser.js";

export class GearCyberwareCyberlimbAccessoryParser extends BaseItemParser {
  static ITEM_TYPE = "gear.CYBERWARE.CYBER_LIMB_ACCESSORY";

  static DEFAULT_RATING_MIN = 1;
  static DEFAULT_RATING_MAX = 6;

  getCyberwareSubtype() {
    return "CYBER_LIMB_ACCESSORY";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const headerIndex = lines.findIndex((line) => this.isCyberlimbAccessoryHeader(line));
    const beforeHeader = headerIndex >= 0 ? lines.slice(0, headerIndex) : [];
    const afterHeader = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;

    const parsedTable = this.parseCyberlimbAccessoryTableWithRemainder(afterHeader);
    const descriptionSourceLines = this.combineDescriptionSources(beforeHeader, parsedTable.remainingLines);
    const sections = this.parseDescriptionSections(descriptionSourceLines);
    const rows = parsedTable.rows;
    const items = [];
    const warnings = [];
    const generatedRows = new Set();

    if (!rows.length) {
      warnings.push("No cyberlimb accessory rows found after the cyberlimb accessory table header. Check the pasted table format.");
    }

    for (const section of sections) {
      const matchingRows = this.findRowsForSection(section.name, rows);
      if (!matchingRows.length) {
        warnings.push(`Cyberlimb accessory table row not found for "${section.name}". No items were created for that entry.`);
        continue;
      }

      for (const row of matchingRows) {
        generatedRows.add(row);
        items.push(...this.expandCyberlimbAccessoryItem({
          baseName: section.name,
          descriptionLines: section.descriptionLines,
          row
        }));
      }
    }

    // Cyberlimb accessory blocks are commonly pasted as a table plus only some
    // descriptions. Keep all valid rows and attach descriptions where available.
    for (const row of rows) {
      if (generatedRows.has(row)) continue;

      items.push(...this.expandCyberlimbAccessoryItem({
        baseName: this.cleanAccessoryName(row.name),
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

  ensureText() {
    return Boolean(String(this.text ?? "").trim());
  }

  isCyberlimbAccessoryHeader(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    return /^ACCESSORIES\s+CAPACITY\s+AVAIL\s+COST\b/u.test(normalized)
      || (normalized.includes("ACCESSORIES")
        && normalized.includes("CAPACITY")
        && normalized.includes("AVAIL")
        && normalized.includes("COST"));
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

  parseCyberlimbAccessoryTableWithRemainder(lines = []) {
    const rows = [];
    let buffer = [];
    let consumed = 0;

    const flush = () => {
      const rawRow = buffer.join(" ").replace(/\s+/g, " ").trim();
      buffer = [];
      if (!rawRow) return false;

      const row = this.parseCyberlimbAccessoryRow(rawRow);
      if (!row) return false;

      rows.push(row);
      return true;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const clean = String(lines[index] ?? "").trim();
      if (!clean) {
        consumed = index + 1;
        continue;
      }

      if (!buffer.length && rows.length && !this.canStartOrContinueCyberlimbAccessoryRow(clean)) {
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

  canStartOrContinueCyberlimbAccessoryRow(line) {
    const normalized = String(line ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) return false;

    return /¥/u.test(normalized)
      || /\[\s*(?:Rating|\d+)\s*\]/iu.test(normalized)
      || /\bRating\b/iu.test(normalized)
      || /^(?:\d+(?:\([LI]\))?|—|-)\s+/iu.test(normalized);
  }

  parseCyberlimbAccessoryRow(rawRow) {
    const row = String(rawRow ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!row) return null;

    const capacityPattern = String.raw`(?:\[\s*(?:Rating|\d+)\s*\]|\d+|—|-)`;
    const availabilityPattern = String.raw`(?:Rating|\d+(?:\([LI]\))?|—|-)`;

    const regex = new RegExp(
      String.raw`^(.+?)\s+(${capacityPattern})\s+(${availabilityPattern})\s+(.+)$`,
      "iu"
    );

    const match = row.match(regex);
    if (!match) return null;

    return {
      raw: row,
      name: match[1].trim(),
      capacity: match[2].trim(),
      availability: match[3].trim(),
      cost: match[4].trim()
    };
  }

  expandCyberlimbAccessoryItem({ baseName, descriptionLines, row }) {
    const ratingRange = this.extractRatingRange(row.name);
    const cleanName = this.cleanAccessoryName(row.name || baseName);
    const ratings = ratingRange
      ? Array.from({ length: ratingRange.max - ratingRange.min + 1 }, (_v, i) => ratingRange.min + i)
      : this.rowRequiresRating(row)
        ? Array.from(
          { length: GearCyberwareCyberlimbAccessoryParser.DEFAULT_RATING_MAX - GearCyberwareCyberlimbAccessoryParser.DEFAULT_RATING_MIN + 1 },
          (_v, i) => GearCyberwareCyberlimbAccessoryParser.DEFAULT_RATING_MIN + i
        )
        : [0];

    const items = [];

    for (const rating of ratings) {
      const basePrice = this.parsePrice(row.cost, rating);
      const capacity = this.parseCapacity(row.capacity, rating);
      const availability = this.parseAvailabilityForRating(row.availability, rating);

      const item = this.toCyberlimbAccessoryFoundryItem({
        name: this.buildAccessoryName(cleanName, rating),
        description: this.buildDescription(descriptionLines, row, rating),
        row,
        rating,
        capacity,
        price: basePrice.price,
        priceDef: basePrice.priceDef,
        avail: availability.avail,
        availDef: availability.availDef
      });

      item.system.notes = this.buildCyberlimbAccessoryNotes(row, rating);
      item.flags["shadowrun-items-importer"] = {
        ...(item.flags["shadowrun-items-importer"] ?? {}),
        tableRow: row,
        cyberlimbAccessory: {
          capacity,
          rating: Number(rating) || 0,
          baseAvailability: this.resolveRatingToken(row.availability, rating),
          ratingRange: this.rowRequiresRating(row)
            ? {
              min: GearCyberwareCyberlimbAccessoryParser.DEFAULT_RATING_MIN,
              max: GearCyberwareCyberlimbAccessoryParser.DEFAULT_RATING_MAX
            }
            : null
        }
      };

      items.push(item);
    }

    return items;
  }

  rowRequiresRating(row) {
    return /\bRating\b/iu.test(`${row?.name ?? ""} ${row?.capacity ?? ""} ${row?.availability ?? ""} ${row?.cost ?? ""}`);
  }

  parsePrice(rawCost, rating = 0) {
    const raw = String(rawCost ?? "").trim();
    if (!raw) return { price: 0, priceDef: "" };

    const normalized = raw
      .replace(/¥/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const ratingValue = Number(rating) || 0;
    const expression = normalized
      .replace(/,/g, "")
      .replace(/\brating\b/gi, String(ratingValue))
      .replace(/\^/g, "**")
      .replace(/[×x]/gi, "*");

    const numericPrefix = expression.match(/^\s*(\d+(?:\.\d+)?)/);
    if (/[^\d+\-*/().\s]/u.test(expression)) {
      return {
        price: numericPrefix ? Number(numericPrefix[1]) : 0,
        priceDef: raw
      };
    }

    try {
      // The expression is sanitized to digits/operators/parentheses above.
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${expression});`)();
      return {
        price: Number.isFinite(value) ? Math.round(value) : 0,
        priceDef: raw
      };
    } catch (_error) {
      return {
        price: numericPrefix ? Number(numericPrefix[1]) : 0,
        priceDef: raw
      };
    }
  }

  parseCapacity(rawCapacity, rating = 0) {
    const raw = String(rawCapacity ?? "").trim();
    if (!raw || raw === "—" || raw === "-") return 0;

    const ratingValue = Number(rating) || 0;
    const resolved = raw.replace(/\brating\b/gi, String(ratingValue));
    return this.extractFirstInteger(resolved, 0);
  }

  parseAvailabilityForRating(rawAvail, rating = 0) {
    const resolved = this.resolveRatingToken(rawAvail, rating);
    return this.parseAvailability(resolved);
  }

  parseAvailability(rawAvail) {
    const raw = String(rawAvail ?? "").trim();
    if (!raw || raw === "—" || raw === "-") {
      return { avail: 0, suffix: "", availDef: "" };
    }

    const match = raw.match(/(-?\d+)\s*(\([^)]+\))?/);
    const avail = match ? Number(match[1]) : 0;
    const suffix = match?.[2] ?? "";

    return {
      avail,
      suffix,
      availDef: `${avail}${suffix}`
    };
  }

  resolveRatingToken(value, rating = 0) {
    return String(value ?? "").replace(/\bRating\b/giu, String(Number(rating) || 0));
  }

  extractRatingRange(name) {
    const match = String(name ?? "").match(/\((?:rating\s*)?(\d+)\s*[–-]\s*(\d+)\)/i);
    if (!match) return null;

    const min = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
    return { min, max };
  }

  cleanAccessoryName(name) {
    return String(name ?? "")
      .replace(/\s*\((?:rating\s*)?\d+\s*[–-]\s*\d+\)\s*/iu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  buildAccessoryName(baseName, rating) {
    const ratingPart = rating ? ` Rating ${rating}` : "";
    return `${baseName}${ratingPart}`;
  }

  buildDescription(descriptionLines = [], row = null, rating = 0) {
    const body = this.joinWrappedText(descriptionLines);
    const meta = [];

    if (row) {
      meta.push(`<p><strong>Cyberlimb accessory table row:</strong> ${row.raw}</p>`);
      meta.push(`<p><strong>Capacity:</strong> ${this.parseCapacity(row.capacity, rating)}</p>`);
    }

    if (rating) {
      meta.push(`<p><strong>Rating:</strong> ${rating}</p>`);
    }

    if (row && this.rowRequiresRating(row) && !this.extractRatingRange(row.name)) {
      meta.push(`<p><strong>Rating range:</strong> ${GearCyberwareCyberlimbAccessoryParser.DEFAULT_RATING_MIN}-${GearCyberwareCyberlimbAccessoryParser.DEFAULT_RATING_MAX}</p>`);
    }

    return `${body ? `<p>${body}</p>` : ""}${meta.join("")}`;
  }

  joinWrappedText(lines = []) {
    return lines
      .map((line) => String(line ?? "").trim())
      .filter((line) => line.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  buildCyberlimbAccessoryNotes(row, rating = 0) {
    if (!row) return "";
    const parts = [`Capacity: ${this.parseCapacity(row.capacity, rating)}`];
    if (this.rowRequiresRating(row)) parts.push(`Rating: ${rating}`);
    return parts.join("; ");
  }

  findRowsForSection(sectionName, rows = []) {
    const wanted = this.normalizeMatchName(sectionName);
    if (!wanted) return [];

    const exact = rows.filter((row) => this.normalizeMatchName(this.cleanAccessoryName(row.name)) === wanted);
    if (exact.length) return exact;

    const startsWithSection = rows.filter((row) => this.normalizeMatchName(this.cleanAccessoryName(row.name)).startsWith(wanted));
    if (startsWithSection.length) return startsWithSection;

    return rows.filter((row) => wanted.startsWith(this.normalizeMatchName(this.cleanAccessoryName(row.name))));
  }

  normalizeMatchName(name) {
    return String(name ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "")
      .replace(/\s*\((?:rating\s*)?\d+\s*[–-]\s*\d+\)\s*/iu, " ")
      .replace(/[^a-z0-9]+/gi, "")
      .trim();
  }

  toCyberlimbAccessoryFoundryItem({ name, description, rating, capacity, price, priceDef, avail, availDef }) {
    return {
      name: name || "Unnamed Cyberlimb Accessory",
      type: "gear",
      img: "systems/shadowrun6-eden/icons/compendium/gear/tech_bag.svg",
      system: {
        genesisID: "",
        description: description ?? "",
        product: "",
        page: 0,
        modifier: 0,
        wild: false,
        pool: 0,
        type: "CYBERWARE",
        subtype: this.getCyberwareSubtype(),
        count: 0,
        countable: false,
        availDef: availDef ?? "",
        avail: Number.isFinite(avail) ? avail : 0,
        ammocap: 0,
        ammocount: 0,
        ammoLoaded: "regular",
        priceDef: Number.isFinite(price) ? price : (priceDef || 0),
        price: Number.isFinite(price) ? price : 0,
        customName: "",
        usedForPool: false,
        notes: "",
        accessories: "",
        needsRating: Boolean(rating),
        rating: Number(rating) || 0,
        skill: "",
        skillSpec: "",
        dmg: 0,
        stun: false,
        dmgDef: "",
        attackRating: [0, 0, 0, 0, 0],
        modes: {
          BF: false,
          FA: false,
          SA: false,
          SS: false
        },
        defense: 0,
        social: 0,
        essence: 0,
        capacity: Number.isFinite(capacity) ? capacity : 0,
        natural: false,
        devRating: 0,
        a: 0,
        s: 0,
        d: 0,
        f: 0,
        progSlots: 0,
        handlOn: 0,
        handlOff: 0,
        accOn: 0,
        accOff: 0,
        spdiOn: 0,
        spdiOff: 0,
        tspd: 0,
        bod: 0,
        arm: 0,
        pil: 0,
        sen: 0,
        sea: 0,
        vtype: "",
        vehicle: {
          opMode: "manual"
        },
        strWeapon: false,
        dualHand: false
      },
      effects: [],
      folder: this.folderId ?? null,
      flags: {}
    };
  }
}
