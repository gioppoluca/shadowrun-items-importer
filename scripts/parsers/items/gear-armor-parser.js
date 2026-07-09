import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

/**
 * Parser for Shadowrun 6 Eden armor tables.
 *
 * Supported table shape:
 *   TYPE DEFENSE RATING CAPACITY AVAIL COST
 *   Armor jacket +4 8 2 1,000¥
 *   w/helmet +2 6 — 500¥
 *
 * Optional prose blocks can be placed before or after the table and separated by
 * a line made of dashes. The first line of each block is matched against the
 * armor row name and used as that item's description.
 */
export class GearArmorParser extends BaseItemParser {
  static ITEM_TYPE = "gear.ARMOR.ARMOR_BODY";

  constructor({ text, type, folderId }) {
    super({ text, type, folderId });
    const [, gearType = "ARMOR", gearSubtype = ""] = String(type ?? "").split(".");
    this.gearType = gearType || "ARMOR";
    this.gearSubtype = gearSubtype || "";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    const headerIndex = lines.findIndex((line) => this.isArmorHeader(line));

    if (headerIndex < 0) {
      const name = this.cleanArmorName(lines[0] ?? "Unnamed Armor");
      return this.toFoundryArmorItem({
        name,
        description: this.descriptionHtml(lines.slice(1)),
        row: null,
        warnings: [`No armor table header found for "${name}". Import created with description only.`]
      });
    }

    const introLines = lines.slice(0, headerIndex);
    const { rows, descriptionLines } = this.parseRowsAndTrailingDescriptions(lines.slice(headerIndex + 1));
    const descriptions = this.parseDescriptionSections([...introLines, ...descriptionLines], rows);
    const descriptionByName = new Map(descriptions.map((section) => [section.matchKey, section]));

    if (!rows.length) {
      ui.notifications?.warn("No armor table rows were found.");
      return [];
    }

    const items = rows.map((row) => {
      const section = descriptionByName.get(this.normalizeMatchName(row.name));
      return this.toFoundryArmorItem({
        name: row.name,
        description: this.descriptionHtml(section?.descriptionLines ?? []),
        row,
        warnings: []
      });
    });

    const unmatchedDescriptions = descriptions.filter((section) => !rows.some((row) => this.normalizeMatchName(row.name) === section.matchKey));
    if (unmatchedDescriptions.length) {
      const warnings = unmatchedDescriptions.map((section) => `Armor table row not found for description block "${section.name}".`);
      for (const item of items) {
        item.flags[SII.MODULE_ID] = {
          ...(item.flags[SII.MODULE_ID] ?? {}),
          warnings
        };
      }
    }

    return items.length === 1 ? items[0] : items;
  }

  isArmorHeader(line) {
    const normalized = String(line ?? "")
      .toUpperCase()
      .replace(/\s+/gu, " ")
      .trim();

    return /^TYPE\s+DEFENSE\s+RATING\s+CAPACITY\s+AVAIL(?:ABILITY)?\s+COST\b/u.test(normalized);
  }

  parseRowsAndTrailingDescriptions(lines = []) {
    const rows = [];
    const descriptionLines = [];
    let buffer = [];

    for (const line of lines) {
      const cleaned = String(line ?? "").trim();
      if (!cleaned || this.isArmorHeader(cleaned)) continue;

      if (this.looksLikeArmorRowStart(cleaned) || buffer.length) {
        buffer.push(cleaned);

        if (/¥\s*$/u.test(cleaned)) {
          const rawRow = buffer.join(" ");
          const parsed = this.parseArmorRow(rawRow);
          if (parsed) rows.push(parsed);
          else descriptionLines.push(...buffer);
          buffer = [];
        }
        continue;
      }

      descriptionLines.push(cleaned);
    }

    if (buffer.length) {
      const parsed = this.parseArmorRow(buffer.join(" "));
      if (parsed) rows.push(parsed);
      else descriptionLines.push(...buffer);
    }

    return { rows, descriptionLines };
  }

  looksLikeArmorRowStart(line) {
    const normalized = this.normalizeTableRow(line);
    return /\s[+–—-]?\d+\s+\d+\s+(?:\d+(?:\([A-Z]\))?|[-–—])\s+[^\s]+¥\s*$/iu.test(normalized)
      || /^w\/\s*helmet\b/iu.test(normalized);
  }

  parseArmorRow(rawRow) {
    const row = this.normalizeTableRow(rawRow);
    const tokens = row.split(/\s+/u).filter(Boolean);
    if (tokens.length < 5) return null;

    const cost = tokens[tokens.length - 1];
    const availability = tokens[tokens.length - 2];
    const capacity = tokens[tokens.length - 3];
    const defenseRating = tokens[tokens.length - 4];
    const rawName = tokens.slice(0, -4).join(" ").trim();
    const name = this.cleanArmorName(rawName);

    if (!name || !/¥\s*$/u.test(cost) || !/^[+–—-]?\d+$/u.test(defenseRating)) return null;

    return {
      raw: row,
      rawName,
      name,
      normalizedName: this.normalizeMatchName(name),
      defenseRatingRaw: defenseRating,
      defense: this.toNumber(defenseRating),
      capacityRaw: capacity,
      capacity: this.toNumber(capacity),
      availabilityRaw: availability,
      availability: this.parseAvailability(availability),
      cost,
      price: this.parseCost(cost),
      subtype: this.inferArmorSubtype(name, rawName)
    };
  }

  cleanArmorName(value) {
    const raw = String(value ?? "")
      .replace(/\s+/gu, " ")
      .trim();

    const withoutWithPrefix = raw
      .replace(/^w\/\s*/iu, "")
      .replace(/^with\s+/iu, "")
      .trim();

    if (!withoutWithPrefix) return raw || "Unnamed Armor";
    if (/^w\//iu.test(raw) || withoutWithPrefix === withoutWithPrefix.toLowerCase()) {
      return this.titleCase(withoutWithPrefix);
    }

    return withoutWithPrefix;
  }

  inferArmorSubtype(name, rawName = name) {
    const normalized = this.normalizeMatchName(`${rawName} ${name}`);

    if (normalized.includes("helmet") || normalized.includes("helm")) return "ARMOR_HELMET";
    if (normalized.includes("shield")) return "ARMOR_SHIELD";
    if (normalized.includes("actioneerbusinessclothes") || normalized.includes("armorclothing")) return "ARMOR_SOCIAL";

    return this.gearSubtype && this.gearSubtype.startsWith("ARMOR_") ? this.gearSubtype : "ARMOR_BODY";
  }

  parseAvailability(value) {
    const raw = String(value ?? "").trim();
    if (!raw || /^[-–—]$/u.test(raw)) return { avail: 0, availDef: "" };
    return {
      avail: this.extractFirstInteger(raw, 0),
      availDef: raw
    };
  }

  parseCost(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return { price: 0, priceDef: 0 };

    const withoutCurrency = raw.replace(/¥/gu, "").trim();
    if (/[()+x]/iu.test(withoutCurrency)) return { price: 0, priceDef: raw };

    const normalized = withoutCurrency.replace(/[,_\s]/gu, "");
    const numeric = Number(normalized);
    return {
      price: Number.isFinite(numeric) ? numeric : 0,
      priceDef: Number.isFinite(numeric) ? numeric : raw
    };
  }

  toNumber(value) {
    const normalized = String(value ?? "")
      .replace(/[+−–—]/gu, (char) => (char === "+" ? "" : "-"))
      .replace(/[^\d.-]/gu, "")
      .trim();

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  parseDescriptionSections(lines = [], rows = []) {
    const rowNames = new Set(rows.map((row) => this.normalizeMatchName(row.name)));
    const sections = [];
    let current = [];

    const flush = () => {
      const cleaned = current.map((line) => String(line ?? "").trim()).filter(Boolean);
      current = [];
      if (!cleaned.length) return;

      const name = this.cleanArmorName(cleaned[0]);
      const matchKey = this.normalizeMatchName(name);
      if (!rowNames.has(matchKey)) return;

      sections.push({
        name,
        matchKey,
        descriptionLines: cleaned.slice(1)
      });
    };

    for (const line of lines) {
      const cleaned = String(line ?? "").trim();
      if (!cleaned || this.isArmorHeader(cleaned) || this.parseArmorRow(cleaned)) continue;

      if (/^-{3,}$/u.test(cleaned)) {
        flush();
        continue;
      }

      const candidateKey = this.normalizeMatchName(this.cleanArmorName(cleaned));
      if (rowNames.has(candidateKey) && current.length) {
        flush();
      }

      current.push(cleaned);
    }

    flush();
    return sections;
  }

  descriptionHtml(lines = []) {
    const text = this.joinWrappedText(lines);
    return text ? `<p>${text}</p>` : "";
  }

  joinWrappedText(lines = []) {
    return lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  normalizeTableRow(value) {
    return String(value ?? "")
      .replace(/\u00A0/gu, " ")
      .replace(/[‐‑‒–—]/gu, "—")
      .replace(/\s+/gu, " ")
      .trim();
  }

  normalizeMatchName(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[’']/gu, "")
      .replace(/&/gu, "and")
      .replace(/[^a-z0-9]+/gu, "")
      .trim();
  }

  titleCase(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
  }

  toFoundryArmorItem({ name, description = "", row = null, warnings = [] } = {}) {
    const itemName = name || row?.name || "Unnamed Armor";
    const parsedAvailability = row?.availability ?? { avail: 0, availDef: "" };
    const parsedCost = row?.price ?? { price: 0, priceDef: 0 };
    const defense = Number(row?.defense ?? 0) || 0;
    const capacity = Number(row?.capacity ?? 0) || 0;
    const subtype = row?.subtype || this.inferArmorSubtype(itemName);
    const notes = row?.raw ? `<p><strong>Armor table row:</strong> ${row.raw}</p>` : "";
    const effects = defense ? [this.buildArmorDefenseEffect(itemName, defense)] : [];

    return {
      name: itemName,
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
        type: "ARMOR",
        subtype,
        count: 0,
        countable: false,
        availDef: parsedAvailability.availDef,
        avail: parsedAvailability.avail,
        ammocap: 0,
        ammocount: 0,
        ammoLoaded: "regular",
        priceDef: parsedCost.priceDef,
        price: parsedCost.price,
        customName: "",
        usedForPool: false,
        notes,
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
        defense,
        social: 0,
        essence: 0,
        capacity,
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
      effects,
      folder: this.folderId ?? null,
      flags: {
        [SII.MODULE_ID]: {
          sourceParser: this.constructor.name,
          tableRow: row ? {
            raw: row.raw,
            rawName: row.rawName,
            name: row.name,
            normalizedName: row.normalizedName,
            defense: row.defense,
            capacity: row.capacity,
            availability: row.availabilityRaw,
            cost: row.cost,
            subtype
          } : null,
          warnings
        }
      }
    };
  }

  buildArmorDefenseEffect(itemName, defense) {
    return {
      name: itemName || "Armor",
      img: "systems/shadowrun6-eden/icons/compendium/cyberware/memory_chip.svg",
      type: "base",
      system: {
        level: 1,
        advanced: false
      },
      changes: [
        {
          key: "system.defenserating.physical.mod",
          mode: 2,
          value: String(defense),
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
      description: `<p><strong>Armor Defense Rating:</strong> +${defense}</p>`,
      tint: "#ffffff",
      transfer: true,
      statuses: [],
      sort: 0,
      flags: {}
    };
  }
}
