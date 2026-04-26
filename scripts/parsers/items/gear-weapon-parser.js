import { BaseItemParser } from "./base-item-parser.js";

/**
 * Parser for Shadowrun 6 Eden weapon gear blocks.
 *
 * The source PDFs usually export weapons as:
 *   1. one weapon name line
 *   2. description prose
 *   3. a full category table containing many weapons
 *
 * The importer must create only the weapon(s) named in the prose block and must
 * discard the other table rows. Rows are collected from the table header until
 * the cost field ending with "¥" because weapon names and attack ratings may be
 * wrapped across multiple extracted lines.
 *
 * Multi-import convention:
 *   If the text before the shared table contains blocks separated by a line made
 *   of dashes (---), each block is treated as a weapon entry. The shared table is
 *   parsed once, then each requested weapon receives the matching row.
 */
export class GearWeaponParser extends BaseItemParser {
  static ITEM_TYPE_PREFIX = "gear.WEAPON";

  constructor({ text, type, folderId }) {
    super({ text, type, folderId });
    const [, gearType = "WEAPON_FIREARMS", gearSubtype = ""] = String(type ?? "").split(".");
    this.gearType = gearType;
    this.gearSubtype = gearSubtype;
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return this.toFoundryItem({ name: "Unnamed Weapon" });

    const headerIndex = this.findWeaponTableHeaderIndex(lines);
    if (headerIndex < 0) {
      const name = lines[0] ?? "Unnamed Weapon";
      return this.toFoundryItem({
        name,
        description: this.descriptionHtml(lines.slice(1)),
        warnings: [`No weapon table header found for "${name}". Import created with description only.`]
      });
    }

    const header = lines[headerIndex];
    const headerInfo = this.parseHeader(header);
    const introLines = lines.slice(0, headerIndex);
    const tableLines = lines.slice(headerIndex + 1);
    const wantedBlocks = this.parseRequestedWeaponBlocks(introLines);
    const tableRows = this.parseWeaponRows(tableLines, headerInfo);

    const items = [];
    const emittedKeys = new Set();

    for (const block of wantedBlocks) {
      const rows = this.findMatchingRows(block.name, tableRows);
      const description = this.descriptionHtml(block.descriptionLines);

      if (!rows.length) {
        items.push(this.toFoundryItem({
          name: block.name,
          description,
          row: null,
          headerInfo,
          warnings: [`No matching weapon table row found for "${block.name}". Check the imported item manually.`]
        }));
        continue;
      }

      for (const row of rows) {
        const key = row.normalizedName || this.normalizeComparableName(row.name);
        if (emittedKeys.has(key)) continue;
        emittedKeys.add(key);

        items.push(this.toFoundryItem({
          name: row.name,
          description,
          row,
          headerInfo,
          warnings: []
        }));
      }
    }

    return items.length === 1 ? items[0] : items;
  }

  findWeaponTableHeaderIndex(lines) {
    return lines.findIndex((line) => /^WEAPON\s+DV\b/i.test(line));
  }

  parseHeader(header) {
    const normalized = String(header ?? "").toUpperCase();
    return {
      hasModes: /\bMODES\b/.test(normalized),
      hasAmmo: /\bAMMO\b/.test(normalized)
    };
  }

  parseRequestedWeaponBlocks(lines) {
    const blocks = [];
    let current = [];

    const flush = () => {
      const cleaned = current.map((line) => String(line ?? "").trim()).filter(Boolean);
      current = [];
      if (!cleaned.length) return;
      blocks.push({
        name: cleaned[0],
        descriptionLines: cleaned.slice(1)
      });
    };

    for (const line of lines) {
      if (/^-{3,}$/.test(line.trim())) {
        flush();
      } else {
        current.push(line);
      }
    }
    flush();

    return blocks.length ? blocks : [{ name: "Unnamed Weapon", descriptionLines: [] }];
  }

  parseWeaponRows(tableLines, headerInfo) {
    const rows = [];
    let buffer = [];

    for (const line of tableLines) {
      const cleaned = String(line ?? "").trim();
      if (!cleaned) continue;
      if (/^WEAPON\s+DV\b/i.test(cleaned)) continue;

      buffer.push(cleaned);

      if (/¥\s*$/u.test(cleaned)) {
        const rawRow = buffer.join(" ");
        const parsed = this.parseWeaponRow(rawRow, headerInfo);
        if (parsed) rows.push(parsed);
        buffer = [];
      }
    }

    if (buffer.length) {
      const parsed = this.parseWeaponRow(buffer.join(" "), headerInfo);
      if (parsed) rows.push(parsed);
    }

    return rows;
  }

  parseWeaponRow(rawRow, headerInfo) {
    const normalized = this.normalizeTableRow(rawRow);
    // Launcher rows use textual DV values ("Grenade" or "Missile") instead of
    // the usual numeric damage code. Keep those words in the DV column; otherwise
    // the parser would treat them as part of the weapon name and fail to import
    // launcher table rows such as "Ares Antioch II Grenade SS ...".
    const rowMatch = normalized.match(/^(.+?)\s+((?:Grenade|Missile)|(?:\([^)]*Rating[^)]*\)|\(?Rating(?:\/\d+)?\)?|\d+)[PS](?:\(e\))?|[-–—])\s+(.+)$/iu);
    if (!rowMatch) return null;

    const name = rowMatch[1].trim();
    const dv = rowMatch[2].trim();
    const tokens = rowMatch[3].trim().split(/\s+/u).filter(Boolean);

    const availabilityIndex = this.findAvailabilityIndex(tokens);
    const availability = availabilityIndex >= 0 ? tokens[availabilityIndex] : "";
    const cost = availabilityIndex >= 0 ? tokens.slice(availabilityIndex + 1).join(" ") : "";
    const left = availabilityIndex >= 0 ? tokens.slice(0, availabilityIndex) : tokens;

    let modes = "";
    let ammo = "";
    let attackRatings = "";

    if (headerInfo.hasModes && left.length && this.looksLikeModeToken(left[0])) {
      modes = left.shift();
    }

    if (headerInfo.hasAmmo && left.length) {
      ammo = left.pop();
    }

    attackRatings = left.join(" ").replace(/\s+/g, " ").trim();

    return {
      raw: normalized,
      name,
      normalizedName: this.normalizeComparableName(name),
      dv,
      modes,
      attackRatings,
      ammo,
      availability,
      cost
    };
  }

  normalizeTableRow(row) {
    return String(row ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/[–—]/g, "—")
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, " ")
      .trim();
  }

  findAvailabilityIndex(tokens) {
    for (let i = tokens.length - 2; i >= 0; i -= 1) {
      const costCandidate = tokens.slice(i + 1).join(" ");
      if (!/¥\s*$/u.test(costCandidate)) continue;
      // A numeric token can be part of a formula cost, e.g.
      // "(Rating/3)(L) 100 + (rating x 10)¥". In that case the
      // real availability is the token before the cost formula, not "100".
      if (/^[+)x]/iu.test(costCandidate)) continue;
      if (this.looksLikeAvailability(tokens[i])) return i;
    }
    return -1;
  }

  looksLikeAvailability(token) {
    return /^(?:\d+|\(?Rating\/\d+\)?)(?:\([A-Z]\))?$/iu.test(String(token ?? "")) || /^[-–—]$/.test(String(token ?? ""));
  }

  looksLikeModeToken(token) {
    return /^(?:SS|SA|BF|FA)(?:\/(?:SS|SA|BF|FA))*$/i.test(String(token ?? ""));
  }

  findMatchingRows(name, rows) {
    const wanted = this.normalizeComparableName(name);
    if (!wanted) return [];

    const exact = rows.filter((row) => row.normalizedName === wanted);
    if (exact.length) return exact;

    const seriesMatches = this.findSeriesRows(name, rows);
    if (seriesMatches.length) return seriesMatches;

    const loose = rows.filter((row) => row.normalizedName.includes(wanted) || wanted.includes(row.normalizedName));
    return loose.length ? loose : [];
  }

  /**
   * Matches family names such as:
   *   - "Ares Light Fire Series" -> Ares Light Fire 70, Ares Light Fire 75
   *   - "Beretta T-series" -> Beretta 101T, Beretta 201T
   *
   * The Shadowrun weapon descriptions sometimes describe a series/family while
   * the statistics table contains one row per model. When the name ends with
   * "series" we intentionally expand the import to every matching row.
   *
   * For "X Series" we treat X as a row prefix. For "X Y-series" we treat X as
   * the prefix and Y as a suffix that may appear after the model number.
   */
  findSeriesRows(name, rows) {
    const source = String(name ?? "").trim();
    const hyphenSeries = source.match(/^(.+?)\s+([^\s-]+)\s*-\s*series$/iu);

    if (hyphenSeries) {
      const prefix = this.normalizeComparableName(hyphenSeries[1]);
      const suffix = this.normalizeComparableName(hyphenSeries[2]);
      if (!prefix || !suffix) return [];

      return rows.filter((row) => {
        if (!row.normalizedName.startsWith(`${prefix} `)) return false;
        const remainder = row.normalizedName.slice(prefix.length).trim();
        return remainder.split(/\s+/u).some((token) => token.endsWith(suffix));
      });
    }

    if (!/\bseries\b/iu.test(source)) return [];

    const prefix = this.normalizeComparableName(source.replace(/\bseries\b/giu, ""));
    if (!prefix) return [];

    return rows.filter((row) => row.normalizedName === prefix || row.normalizedName.startsWith(`${prefix} `));
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
   * Shadowrun 6 weapon prices use English-style thousands separators.
   *
   * Examples:
   *   - 7,000¥ -> price 7000
   *   - 1,800¥ -> price 1800
   *   - 100 + (rating x 10)¥ -> formula, keep it in priceDef and leave price 0
   *
   * Do not replace commas with decimal separators: in these tables a comma is
   * a thousands separator, not a decimal separator.
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

  parseAttackRatings(value) {
    const parts = String(value ?? "")
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    while (parts.length < 5) parts.push("—");

    return parts.slice(0, 5).map((part) => {
      if (/^[-–—]$/.test(part)) return 0;
      if (/rating/i.test(part)) return 0;
      const numeric = String(part).match(/\d+/);
      return numeric ? Number(numeric[0]) : 0;
    });
  }

  buildModes(modeText) {
    const active = String(modeText ?? "").toUpperCase().split("/").map((mode) => mode.trim()).filter(Boolean);
    return {
      BF: active.includes("BF"),
      FA: active.includes("FA"),
      SA: active.includes("SA"),
      SS: active.includes("SS")
    };
  }

  inferSkill() {
    if (this.gearType === "WEAPON_FIREARMS") return "firearms";
    if (this.gearType === "WEAPON_CLOSE_COMBAT") return "close_combat";
    if (this.gearType === "WEAPON_PROJECTILE_THROWN") return "athletics";
    return "";
  }

  inferSkillSpec() {
    return String(this.gearSubtype ?? "").toLowerCase();
  }

  toFoundryItem({ name, description = "", row = null, warnings = [] } = {}) {
    const dv = row?.dv ?? "";
    const damageNumber = this.extractFirstInteger(dv, 0);
    const isStun = /S/i.test(dv);
    const parsedCost = this.parseCost(row?.cost);

    const notes = row
      ? [
          row.raw ? `<p><strong>Imported table row:</strong> ${row.raw}</p>` : "",
          row.attackRatings && /rating/i.test(row.attackRatings) ? `<p><strong>Attack ratings formula:</strong> ${row.attackRatings}</p>` : "",
          row.cost && /rating/i.test(row.cost) ? `<p><strong>Cost formula:</strong> ${row.cost}</p>` : ""
        ].filter(Boolean).join("")
      : "";

    return {
      name: name || row?.name || "Unnamed Weapon",
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
        type: this.gearType || "WEAPON_FIREARMS",
        subtype: this.gearSubtype || "",
        count: 0,
        countable: false,
        availDef: row?.availability ?? "",
        avail: this.extractFirstInteger(row?.availability, 0),
        ammocap: this.extractFirstInteger(row?.ammo, 0),
        ammocount: 0,
        ammoLoaded: "regular",
        priceDef: parsedCost.priceDef,
        price: parsedCost.price,
        customName: "",
        usedForPool: false,
        notes,
        accessories: "",
        needsRating: Boolean(row && /rating/i.test(`${row.dv} ${row.attackRatings} ${row.availability} ${row.cost}`)),
        rating: 0,
        skill: this.inferSkill(),
        skillSpec: this.inferSkillSpec(),
        dmg: damageNumber,
        stun: isStun,
        dmgDef: dv,
        attackRating: this.parseAttackRatings(row?.attackRatings),
        modes: this.buildModes(row?.modes),
        defense: 0,
        social: 0,
        essence: 0,
        capacity: 0,
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
        strWeapon: Boolean(row && /rating/i.test(row.dv)),
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
