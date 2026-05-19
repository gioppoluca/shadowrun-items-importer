import { BaseItemParser } from "./base-item-parser.js";

/**
 * Parser for Shadowrun 6 Eden vehicle gear.
 *
 * Supported inputs:
 * 1) Catalog tables grouped by subtype, followed by optional description blocks:
 *    CARS HAND(ON/OFF ROAD) ACCEL SPEED-INTERVAL ... COST
 *    Ford Americar 4/5 9 20 160 11 4 1 2 4 2 16,000¥
 *    ...
 *    Ford Americar
 *    Description...
 *    ---
 *
 * 2) Single vehicle blocks with a stat row and equipment/note lines:
 *    General Dynamics Flyer 90
 *    (special operations vehicle)
 *    HAND ACC SPD-INT TOP-SPD BODY ARM PILOT SENS SEAT AVAIL COST
 *    3/3 20 25 170 12 6 1 1 5 8 60,000¥
 *    Standard Equipment: ...
 *    Note: ...
 */
export class GearVehicleItemParser extends BaseItemParser {
  constructor({ text, type, folderId }) {
    super({ text, type, folderId });
    const parts = String(type ?? "").split(".");
    this.gearType = parts[1] || "VEHICLES";
    this.requestedSubtype = parts[2] || "";
  }

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    const parsed = this.parseVehicleRows(lines);
    let rows = this.filterRowsByRequestedSubtype(parsed.rows);
    const descriptions = this.extractDescriptionBlocks(lines, parsed.lastRowLineIndex, rows);

    // In catalog-table mode, the table is a lookup source. When prose blocks are
    // present, create only the vehicles that have a matching prose section.
    // Single-vehicle stat blocks are still created because they carry inline
    // accessories/notes and normally also have their own following description.
    if (descriptions.size) {
      rows = rows.filter((row) => descriptions.has(row.normalizedName) || Boolean(row.accessories));
    }

    if (!rows.length) {
      return this.toFoundryItem({
        name: lines[0] || "Unnamed Vehicle",
        row: null,
        description: this.descriptionHtml(lines.slice(1)),
        warnings: ["No vehicle table rows found. Import created with description only."]
      });
    }

    const items = rows.map((row) => {
      const description = descriptions.get(row.normalizedName) || "";
      return this.toFoundryItem({ row, description, accessories: row.accessories || "" });
    });

    return items.length === 1 ? items[0] : items;
  }

  filterRowsByRequestedSubtype(rows) {
    const subtype = this.normalizeSubtypeKey(this.requestedSubtype);
    if (!subtype) return rows;
    const matching = rows.filter((row) => this.normalizeSubtypeKey(row.subtype) === subtype);
    return matching.length ? matching : rows;
  }

  parseVehicleRows(lines = []) {
    const rows = [];
    let currentSection = null;
    let pendingSection = null;
    let headerBuffer = [];
    let buffer = [];
    let bufferStartIndex = -1;
    let lastRowLineIndex = -1;

    const flush = (lineIndex) => {
      if (!buffer.length || !currentSection) {
        buffer = [];
        bufferStartIndex = -1;
        return;
      }

      const parsed = this.parseVehicleRow(buffer.join(" "), currentSection);
      if (parsed) {
        parsed.sourceStartLine = bufferStartIndex;
        parsed.sourceEndLine = lineIndex;
        rows.push(parsed);
        lastRowLineIndex = Math.max(lastRowLineIndex, lineIndex);
      }
      buffer = [];
      bufferStartIndex = -1;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = this.normalizeTableRow(lines[i]);
      if (!line) continue;

      const section = this.parseVehicleHeader(line);
      if (section) {
        flush(i - 1);
        currentSection = section;
        pendingSection = null;
        headerBuffer = [];

        if (section.trailingData) {
          buffer.push(section.trailingData);
          bufferStartIndex = i;
          if (this.looksLikeCompleteVehicleRow(buffer.join(" "))) flush(i);
        }
        continue;
      }

      const singleHeader = this.parseSingleVehicleHeader(line);
      if (singleHeader) {
        flush(i - 1);
        const single = this.parseSingleVehicleBlock(lines, i, singleHeader);
        if (single) {
          rows.push(single.row);
          lastRowLineIndex = Math.max(lastRowLineIndex, single.lastConsumedLineIndex);
          i = single.lastConsumedLineIndex;
          currentSection = null;
          pendingSection = null;
          headerBuffer = [];
          buffer = [];
          bufferStartIndex = -1;
        }
        continue;
      }

      const categoryOnly = this.detectVehicleCategory(line.toUpperCase());
      if (categoryOnly && !this.looksLikeCompleteVehicleRow(line)) {
        flush(i - 1);
        pendingSection = categoryOnly;
        headerBuffer = [line];
        continue;
      }

      if (pendingSection) {
        headerBuffer.push(line);
        const combinedHeader = this.normalizeTableRow(headerBuffer.join(" "));
        const completedSection = this.parseVehicleHeader(combinedHeader);
        if (completedSection) {
          currentSection = completedSection;
          pendingSection = null;
          headerBuffer = [];

          if (completedSection.trailingData) {
            buffer.push(completedSection.trailingData);
            bufferStartIndex = i;
            if (this.looksLikeCompleteVehicleRow(buffer.join(" "))) flush(i);
          }
        }
        continue;
      }

      if (!currentSection) continue;

      if (!buffer.length) bufferStartIndex = i;
      buffer.push(line);
      if (this.looksLikeCompleteVehicleRow(buffer.join(" "))) flush(i);
    }

    flush(lines.length - 1);
    return { rows, lastRowLineIndex };
  }

  parseVehicleHeader(rawLine) {
    const line = this.normalizeTableRow(rawLine);
    const upper = line.toUpperCase();

    const category = this.detectVehicleCategory(upper);
    if (!category) return null;

    if (!/\bHAND\b/u.test(upper) || !/\bCOST\b/u.test(upper)) return null;
    if (!/(?:\bACCEL\b|\bACC\b)/u.test(upper)) return null;

    const costMatch = line.match(/\bCOST\b\s*(.*)$/iu);
    const trailingData = costMatch?.[1]?.trim() || "";

    return {
      label: category.label,
      subtype: category.subtype,
      vtype: category.vtype,
      trailingData
    };
  }

  parseSingleVehicleHeader(rawLine) {
    const line = this.normalizeTableRow(rawLine);
    const upper = line.toUpperCase();
    if (!/^HAND\b/u.test(upper) || !/\bCOST\b/u.test(upper)) return null;
    if (!/(?:\bACC\b|\bACCEL\b)/u.test(upper)) return null;
    return { subtype: this.requestedSubtype || "CARS", vtype: this.vtypeForSubtype(this.requestedSubtype || "CARS") };
  }

  parseSingleVehicleBlock(lines, headerIndex, header) {
    let nameIndex = headerIndex - 1;
    while (nameIndex >= 0 && this.isParentheticalLine(lines[nameIndex])) nameIndex -= 1;
    const name = this.normalizeTableRow(lines[nameIndex] ?? "");
    if (!name) return null;

    let rowLineIndex = headerIndex + 1;
    const rowPieces = [];
    while (rowLineIndex < lines.length) {
      const candidate = this.normalizeTableRow(lines[rowLineIndex]);
      if (!candidate) {
        rowLineIndex += 1;
        continue;
      }
      rowPieces.push(candidate);
      if (this.looksLikeCompleteStatOnlyVehicleRow(rowPieces.join(" "))) break;
      rowLineIndex += 1;
    }

    if (!this.looksLikeCompleteStatOnlyVehicleRow(rowPieces.join(" "))) return null;

    const section = {
      label: this.labelForSubtype(header.subtype),
      subtype: this.normalizeSubtypeKey(header.subtype) || "CARS",
      vtype: header.vtype || this.vtypeForSubtype(header.subtype)
    };
    const row = this.parseVehicleRow(`${name} ${rowPieces.join(" ")}`, section);
    if (!row) return null;

    const accessories = [];
    let i = rowLineIndex + 1;
    let currentAccessory = null;
    while (i < lines.length) {
      const line = this.normalizeTableRow(lines[i]);
      if (!line || line === "---") break;

      if (this.isEquivalentVehicleName(line, row.name)) break;
      if (this.isPotentialDescriptionTitle(line, row.name)) break;

      const labelMatch = line.match(/^(Standard Equipment|Note)\s*:\s*(.*)$/iu);
      if (labelMatch) {
        currentAccessory = { label: this.titleCaseLabel(labelMatch[1]), text: labelMatch[2]?.trim() || "" };
        accessories.push(currentAccessory);
        i += 1;
        continue;
      }

      if (currentAccessory) {
        currentAccessory.text = `${currentAccessory.text} ${line}`.replace(/\s+/gu, " ").trim();
        i += 1;
        continue;
      }

      break;
    }

    row.accessories = this.accessoriesHtml(accessories);
    return { row, lastConsumedLineIndex: Math.max(rowLineIndex, i - 1) };
  }

  detectVehicleCategory(upperLine) {
    const normalized = String(upperLine ?? "").replace(/\s+/gu, " ").trim();

    const categories = [
      { label: "Trucks and Vans", subtype: "TRUCKS_AND_VANS", vtype: "GROUND", pattern: /^TRUCKS\s+AND\s+VANS\b/u },
      { label: "Bikes", subtype: "BIKES", vtype: "GROUND", pattern: /^BIKES\b/u },
      { label: "Cars", subtype: "CARS", vtype: "GROUND", pattern: /^CARS\b/u },
      { label: "Boats", subtype: "BOATS", vtype: "WATER", pattern: /^BOATS\b/u },
      { label: "Drones", subtype: "DRONES", vtype: "DRONE", pattern: /^DRONES\b/u },
      { label: "Aircraft", subtype: "AIRCRAFT", vtype: "AIR", pattern: /^AIRCRAFT\b/u }
    ];

    return categories.find((category) => category.pattern.test(normalized)) ?? null;
  }

  looksLikeCompleteVehicleRow(rawRow) {
    const text = this.normalizeTableRow(rawRow);
    if (!/¥\s*$/u.test(text)) return false;

    const tokens = text.split(/\s+/u).filter(Boolean);
    if (tokens.length < 12) return false;

    const cost = tokens[tokens.length - 1];
    const avail = tokens[tokens.length - 2];
    const handl = tokens[tokens.length - 11];

    return /¥\s*$/u.test(cost)
      && this.looksLikeAvailability(avail)
      && /^\d+(?:\/\d+)?$/u.test(handl);
  }

  looksLikeCompleteStatOnlyVehicleRow(rawRow) {
    const text = this.normalizeTableRow(rawRow);
    if (!/¥\s*$/u.test(text)) return false;
    const tokens = text.split(/\s+/u).filter(Boolean);
    if (tokens.length !== 11) return false;
    return /^\d+(?:\/\d+)?$/u.test(tokens[0]) && this.looksLikeAvailability(tokens[9]);
  }

  parseVehicleRow(rawRow, section) {
    const row = this.normalizeTableRow(rawRow);
    const tokens = row.split(/\s+/u).filter(Boolean);
    if (tokens.length < 12) return null;

    const cost = tokens[tokens.length - 1];
    const availability = tokens[tokens.length - 2];
    const seat = tokens[tokens.length - 3];
    const sensor = tokens[tokens.length - 4];
    const pilot = tokens[tokens.length - 5];
    const armor = tokens[tokens.length - 6];
    const body = tokens[tokens.length - 7];
    const topSpeed = tokens[tokens.length - 8];
    const speedInterval = tokens[tokens.length - 9];
    const accel = tokens[tokens.length - 10];
    const handling = tokens[tokens.length - 11];
    const name = tokens.slice(0, -11).join(" ").trim();

    if (!name || !/^\d+(?:\/\d+)?$/u.test(handling) || !/¥\s*$/u.test(cost)) return null;

    const handlingParts = handling.split("/").map((value) => this.toNumber(value));
    const handlOn = handlingParts[0] ?? 0;
    const handlOff = handlingParts[1] ?? handlOn;

    return {
      raw: row,
      name,
      normalizedName: this.normalizeComparableName(name),
      categoryLabel: section.label,
      subtype: section.subtype,
      vtype: section.vtype,
      handling,
      handlOn,
      handlOff,
      accel: this.toNumber(accel),
      speedInterval: this.toNumber(speedInterval),
      topSpeed: this.toNumber(topSpeed),
      body: this.toNumber(body),
      armor: this.toNumber(armor),
      pilot: this.toNumber(pilot),
      sensor: this.toNumber(sensor),
      seat,
      availability,
      cost
    };
  }

  extractDescriptionBlocks(lines = [], lastRowLineIndex = -1, rows = []) {
    const descriptions = new Map();
    if (!rows.length) return descriptions;

    const start = Math.max(0, lastRowLineIndex + 1);
    const tail = lines.slice(start).map((line) => String(line ?? "").trim());
    const blocks = [];
    let current = [];

    const pushBlock = () => {
      const cleaned = current.map((line) => line.trim()).filter(Boolean);
      if (cleaned.length) blocks.push(cleaned);
      current = [];
    };

    for (const line of tail) {
      if (line.trim() === "---") {
        pushBlock();
      } else {
        current.push(line);
      }
    }
    pushBlock();

    const rowsByName = new Map(rows.map((row) => [row.normalizedName, row]));

    for (const block of blocks) {
      if (!block.length) continue;
      const title = block[0];
      const matchedRow = this.findMatchingRowForTitle(title, rows);
      if (!matchedRow) continue;
      const body = block.slice(1);
      descriptions.set(matchedRow.normalizedName, this.descriptionHtml(body));
      rowsByName.delete(matchedRow.normalizedName);
    }

    return descriptions;
  }

  findMatchingRowForTitle(title, rows) {
    const normalizedTitle = this.normalizeComparableName(title);
    if (!normalizedTitle) return null;

    return rows.find((row) => row.normalizedName === normalizedTitle)
      || rows.find((row) => this.isEquivalentVehicleName(title, row.name))
      || null;
  }

  isEquivalentVehicleName(a, b) {
    const left = this.normalizeComparableName(a);
    const right = this.normalizeComparableName(b);
    if (!left || !right) return false;
    if (left === right) return true;
    return left.replace(/\bmodel\b/gu, "").replace(/\s+/gu, " ").trim()
      === right.replace(/\bmodel\b/gu, "").replace(/\s+/gu, " ").trim();
  }

  isPotentialDescriptionTitle(line, name) {
    const normalized = this.normalizeComparableName(line);
    if (!normalized) return false;
    if (this.isEquivalentVehicleName(line, name)) return true;
    return /^[A-Z][A-Za-z0-9'’\-]+(?:\s+[A-Z][A-Za-z0-9'’\-]+){0,5}$/u.test(String(line ?? ""));
  }

  isParentheticalLine(line) {
    return /^\([^)]*\)$/u.test(String(line ?? "").trim());
  }

  normalizeTableRow(row) {
    return String(row ?? "")
      .replace(/\u00A0/gu, " ")
      .replace(/[–—]/gu, "—")
      .replace(/\bSPD\s*[- ]\s*INT\b/giu, "SPEED-INTERVAL")
      .replace(/\bSPEED\s*[- ]\s*INTERVAL\b/giu, "SPEED-INTERVAL")
      .replace(/\bTOP\s*[- ]\s*SPD\b/giu, "TOP-SPEED")
      .replace(/\bTOP\s*[- ]\s*SPEED\b/giu, "TOP-SPEED")
      .replace(/\bARM\b/giu, "ARMOR")
      .replace(/\bSENS\b/giu, "SENSOR")
      .replace(/\bACCEL\s*[- ]\s*SPEED\s+INTERVAL\b/giu, "ACCEL SPEED-INTERVAL")
      .replace(/\bHAND\s*\(\s*ON\s*\/\s*OFF\s+ROAD\s*\)/giu, "HAND(ON/OFF ROAD)")
      .replace(/\s*\/\s*/gu, "/")
      .replace(/\s+/gu, " ")
      .trim();
  }

  looksLikeAvailability(token) {
    return /^(?:\d+|[-–—])(?:\([A-Z]\))?$/iu.test(String(token ?? ""));
  }

  parseCost(rawCost) {
    const original = String(rawCost ?? "").trim();
    if (!original) return { price: 0, priceDef: 0 };

    const withoutCurrency = original.replace(/¥/gu, "").trim();
    if (/[()+x]/iu.test(withoutCurrency)) return { price: 0, priceDef: original };

    const normalizedNumber = withoutCurrency.replace(/[,_\s]/gu, "");
    const value = Number(normalizedNumber);
    return {
      price: Number.isFinite(value) ? value : 0,
      priceDef: Number.isFinite(value) ? value : original
    };
  }

  toNumber(value, fallback = 0) {
    const normalized = String(value ?? "").replace(/,/gu, "").trim();
    const number = Number(normalized);
    return Number.isFinite(number) ? number : fallback;
  }

  normalizeSubtypeKey(value) {
    return String(value ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "");
  }

  normalizeComparableName(name) {
    return String(name ?? "")
      .toLowerCase()
      .replace(/[’']/gu, "")
      .replace(/-/gu, " ")
      .replace(/[^a-z0-9]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  labelForSubtype(subtype) {
    const key = this.normalizeSubtypeKey(subtype);
    const labels = {
      BIKES: "Bikes",
      CARS: "Cars",
      TRUCKS_AND_VANS: "Trucks and Vans",
      BOATS: "Boats",
      DRONES: "Drones",
      AIRCRAFT: "Aircraft"
    };
    return labels[key] || "Vehicles";
  }

  vtypeForSubtype(subtype) {
    const key = this.normalizeSubtypeKey(subtype);
    if (key === "BOATS") return "WATER";
    if (key === "DRONES") return "DRONE";
    if (key === "AIRCRAFT") return "AIR";
    return "GROUND";
  }

  titleCaseLabel(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/\b\w/gu, (letter) => letter.toUpperCase());
  }

  descriptionHtml(lines = []) {
    const text = lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();

    return text ? `<p>${text}</p>` : "";
  }

  accessoriesHtml(entries = []) {
    const html = entries
      .filter((entry) => entry?.text)
      .map((entry) => `<p><strong>${entry.label}:</strong> ${entry.text}</p>`)
      .join("");
    return html;
  }

  extractFirstInteger(text, fallback = 0) {
    return super.extractFirstInteger(text, fallback);
  }

  toFoundryItem({ name, description = "", row = null, accessories = "", warnings = [] } = {}) {
    const parsedCost = this.parseCost(row?.cost);

    return {
      name: name || row?.name || "Unnamed Vehicle",
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
        type: "VEHICLES",
        subtype: row?.subtype || this.requestedSubtype || "CARS",
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
        notes: row?.raw ? `<p><strong>Vehicle table row:</strong> ${row.raw}</p>` : "",
        accessories,
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
        devRating: 0,
        a: 0,
        s: 0,
        d: 0,
        f: 0,
        progSlots: 0,
        handlOn: row?.handlOn ?? 0,
        handlOff: row?.handlOff ?? 0,
        accOn: row?.accel ?? 0,
        accOff: row?.accel ?? 0,
        spdiOn: row?.speedInterval ?? 0,
        spdiOff: row?.speedInterval ?? 0,
        tspd: row?.topSpeed ?? 0,
        bod: row?.body ?? 0,
        arm: row?.armor ?? 0,
        pil: row?.pilot ?? 0,
        sen: row?.sensor ?? 0,
        sea: this.extractFirstInteger(row?.seat, 0),
        vtype: row?.vtype || "GROUND",
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
          category: row?.categoryLabel ?? "",
          warnings
        }
      }
    };
  }
}
