import { BaseItemParser } from "./base-item-parser.js";

/**
 * Generic parser for Shadowrun 6 Eden electronics device tables.
 *
 * Cyberdecks and commlinks share the same table shape:
 *   ITEM DEVICE RATING ATTRIBUTES (...) ACTIVE PROGRAM SLOTS AVAIL COST
 *
 * The only important difference is which two Foundry system keys receive the
 * attribute pair:
 *   - Cyberdeck: ATTRIBUTES (A/S) -> system.a / system.s
 *   - Commlink:  ATTRIBUTES (D/F) -> system.d / system.f
 *
 * The source text normally contains a shared section description followed by a
 * table. Each table row becomes a separate Foundry item.
 */
export class GearElectronicsDeviceTableParser extends BaseItemParser {
  constructor({ text, type, folderId, gearSubtype, attributeKeys, expectedAttributeLabel }) {
    super({ text, type, folderId });
    this.gearType = "ELECTRONICS";
    this.gearSubtype = gearSubtype;
    this.attributeKeys = attributeKeys;
    this.expectedAttributeLabel = expectedAttributeLabel;
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const header = this.findElectronicsTableHeader(lines);
    if (!header) {
      return this.toFoundryItem({
        name: lines[0] || `Unnamed ${this.gearSubtype}`,
        description: this.descriptionHtml(lines.slice(1)),
        row: null,
        warnings: [`No ${this.gearSubtype.toLowerCase()} table header found. Import created with description only.`]
      });
    }

    const descriptionLines = lines.slice(1, header.startIndex);
    const description = this.descriptionHtml(descriptionLines);
    const tableLines = lines.slice(header.endIndex + 1);
    const rows = this.parseElectronicsRows(tableLines);

    if (!rows.length) {
      return this.toFoundryItem({
        name: lines[0] || `Unnamed ${this.gearSubtype}`,
        description,
        row: null,
        warnings: [`No ${this.gearSubtype.toLowerCase()} rows found after the table header. Check the imported item manually.`]
      });
    }

    return rows.map((row) => this.toFoundryItem({
      name: row.name,
      description,
      row,
      warnings: []
    }));
  }

  findElectronicsTableHeader(lines) {
    for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
      const line = String(lines[startIndex] ?? "").trim();
      if (!/^ITEM\b/i.test(line)) continue;

      let headerText = "";
      for (let endIndex = startIndex; endIndex < Math.min(lines.length, startIndex + 8); endIndex += 1) {
        headerText = `${headerText} ${lines[endIndex]}`.replace(/\s+/g, " ").trim();
        const normalized = headerText.toUpperCase();

        const hasExpectedAttributes = !this.expectedAttributeLabel
          || normalized.includes(`ATTRIBUTES (${this.expectedAttributeLabel.toUpperCase()})`)
          || normalized.includes("ATTRIBUTES");

        if (
          normalized.includes("ITEM")
          && normalized.includes("DEVICE RATING")
          && hasExpectedAttributes
          && normalized.includes("ACTIVE PROGRAM")
          && normalized.includes("SLOTS")
          && normalized.includes("AVAIL")
          && normalized.includes("COST")
        ) {
          return { startIndex, endIndex, text: headerText };
        }
      }
    }

    return null;
  }

  parseElectronicsRows(tableLines) {
    const rows = [];
    let buffer = [];

    for (const line of tableLines) {
      const cleaned = String(line ?? "").trim();
      if (!cleaned) continue;
      if (this.looksLikeHeaderFragment(cleaned)) continue;

      buffer.push(cleaned);

      if (/¥\s*$/u.test(cleaned)) {
        const parsed = this.parseElectronicsRow(buffer.join(" "));
        if (parsed) rows.push(parsed);
        buffer = [];
      }
    }

    if (buffer.length) {
      const parsed = this.parseElectronicsRow(buffer.join(" "));
      if (parsed) rows.push(parsed);
    }

    return rows;
  }

  looksLikeHeaderFragment(line) {
    const normalized = String(line ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    return normalized === "ITEM"
      || normalized === "DEVICE RATING"
      || normalized === "ATTRIBUTES (A/S)"
      || normalized === "ATTRIBUTES (D/F)"
      || normalized === "ACTIVE PROGRAM"
      || normalized === "SLOTS"
      || normalized === "AVAIL COST"
      || normalized === "COST";
  }

  parseElectronicsRow(rawRow) {
    const normalized = this.normalizeTableRow(rawRow);
    const tokens = normalized.split(/\s+/u).filter(Boolean);
    if (tokens.length < 6) return null;

    const cost = tokens.at(-1);
    const availability = tokens.at(-2);
    const programSlotsToken = tokens.at(-3);
    const attributesToken = tokens.at(-4);
    const deviceRatingToken = tokens.at(-5);
    const name = tokens.slice(0, -5).join(" ").trim();

    if (!name || !/¥\s*$/u.test(cost)) return null;
    if (!this.looksLikeInteger(deviceRatingToken)) return null;
    if (!this.looksLikeAttributes(attributesToken)) return null;
    if (!this.looksLikeInteger(programSlotsToken)) return null;
    if (!this.looksLikeAvailability(availability)) return null;

    const [firstAttribute, secondAttribute] = attributesToken
      .split("/")
      .map((value) => this.extractFirstInteger(value, 0));

    return {
      raw: normalized,
      name,
      normalizedName: this.normalizeComparableName(name),
      deviceRating: this.extractFirstInteger(deviceRatingToken, 0),
      firstAttribute,
      secondAttribute,
      attributes: attributesToken,
      programSlots: this.extractFirstInteger(programSlotsToken, 0),
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

  looksLikeInteger(token) {
    return /^\d+$/u.test(String(token ?? "").trim());
  }

  looksLikeAttributes(token) {
    return /^\d+\/\d+$/u.test(String(token ?? "").trim());
  }

  looksLikeAvailability(token) {
    return /^(?:\d+|[-–—])(?:\([A-Z]\))?$/iu.test(String(token ?? ""));
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
   * Shadowrun 6 gear prices use English-style thousands separators.
   * Example: 410,600¥ -> 410600.
   */
  parseCost(rawCost) {
    const original = String(rawCost ?? "").trim();
    if (!original) return { price: 0, priceDef: 0 };

    const withoutCurrency = original.replace(/¥/gu, "").trim();

    if (/[()+x]/iu.test(withoutCurrency)) {
      return {
        price: 0,
        priceDef: original
      };
    }

    const normalizedNumber = withoutCurrency.replace(/[,_\s]/gu, "");
    const value = Number(normalizedNumber);

    return {
      price: Number.isFinite(value) ? value : 0,
      priceDef: Number.isFinite(value) ? value : original
    };
  }

  toFoundryItem({ name, description = "", row = null, warnings = [] } = {}) {
    const parsedCost = this.parseCost(row?.cost);
    const [firstKey, secondKey] = this.attributeKeys;

    const attributes = {
      a: 0,
      s: 0,
      d: 0,
      f: 0
    };

    if (row) {
      attributes[firstKey] = row.firstAttribute ?? 0;
      attributes[secondKey] = row.secondAttribute ?? 0;
    }

    return {
      name: name || row?.name || `Unnamed ${this.gearSubtype}`,
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
        type: this.gearType,
        subtype: this.gearSubtype,
        count: 0,
        countable: false,
        availDef: row?.availability ?? "",
        avail: this.extractFirstInteger(row?.availability, 0),
        ammocap: 0,
        ammocount: 0,
        ammoLoaded: "regular",
        priceDef: parsedCost.priceDef,
        price: parsedCost.price,
        customName: "",
        usedForPool: false,
        notes: "",
        accessories: "",
        needsRating: false,
        rating: 0,
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
        capacity: 0,
        natural: false,
        devRating: row?.deviceRating ?? 0,
        a: attributes.a,
        s: attributes.s,
        d: attributes.d,
        f: attributes.f,
        progSlots: row?.programSlots ?? 0,
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
      flags: {
        "shadowrun-items-importer": {
          sourceParser: this.constructor.name,
          tableRow: row,
          warnings
        }
      }
    };
  }
}
