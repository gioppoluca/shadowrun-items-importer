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

    const documents = rows.flatMap((row) => {
      const description = descriptions.get(row.normalizedName) || "";
      const accessories = row.accessories || "";
      return [
        this.toFoundryItem({ row, description, accessories }),
        this.toFoundryActor({ row, description, accessories })
      ];
    });

    return documents.length === 1 ? documents[0] : documents;
  }

  filterRowsByRequestedSubtype(rows) {
    // Vehicle tables carry their own category in the first header cell
    // (for example CARS, ROTORCRAFT, MINIDRONES). Do not let the
    // importer dropdown override that: the selected subtype is only used
    // as a fallback for single stat blocks that have no category header.
    return rows;
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
      gearType: category.gearType || "VEHICLES",
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
    const subtype = this.requestedSubtype || "CARS";
    return {
      gearType: this.gearTypeForSubtype(subtype),
      subtype,
      vtype: this.vtypeForSubtype(subtype)
    };
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
      gearType: header.gearType || this.gearTypeForSubtype(header.subtype),
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
    const normalized = String(upperLine ?? "")
      .replace(/[\u00AD\uFFFE\uFFFD]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();

    const categories = [
      { label: "Trucks and Vans", gearType: "VEHICLES", subtype: "TRUCKS", vtype: "GROUND", pattern: /^TRUCKS\s+AND\s+VANS\b/u },
      { label: "Fixed-Wing Aircraft", gearType: "VEHICLES", subtype: "FIXED_WING", vtype: "AIR", pattern: /^FIXED\s*[-–—]?\s*WING\s+AIRCRAFT\b/u },
      { label: "VTOL/VSTOL", gearType: "VEHICLES", subtype: "VTOL", vtype: "AIR", pattern: /^VTOL\s*\/\s*VSTOL\b/u },
      { label: "Microdrones", gearType: "DRONES", subtype: "MICRODRONES", vtype: "AUTO", pattern: /^MICRODRONES\b/u },
      { label: "Minidrones", gearType: "DRONES", subtype: "MINIDRONES", vtype: "AUTO", pattern: /^MINIDRONES\b/u },
      { label: "Small Drones", gearType: "DRONES", subtype: "SMALL_DRONES", vtype: "AUTO", pattern: /^SMALL\s+DRONES\b/u },
      { label: "Medium Drones", gearType: "DRONES", subtype: "MEDIUM_DRONES", vtype: "AUTO", pattern: /^MEDIUM\s+DRONES\b/u },
      { label: "Large Drones", gearType: "DRONES", subtype: "LARGE_DRONES", vtype: "AUTO", pattern: /^LARGE\s+DRONES\b/u },
      { label: "Submarines", gearType: "VEHICLES", subtype: "SUBMARINES", vtype: "WATER", pattern: /^SUBMARINES\b/u },
      { label: "Rotorcraft", gearType: "VEHICLES", subtype: "ROTORCRAFT", vtype: "AIR", pattern: /^ROTORCRAFT\b/u },
      { label: "Bikes", gearType: "VEHICLES", subtype: "BIKES", vtype: "GROUND", pattern: /^BIKES\b/u },
      { label: "Cars", gearType: "VEHICLES", subtype: "CARS", vtype: "GROUND", pattern: /^CARS\b/u },
      { label: "Boats", gearType: "VEHICLES", subtype: "BOATS", vtype: "WATER", pattern: /^BOATS\b/u },
      { label: "Aircraft", gearType: "VEHICLES", subtype: "FIXED_WING", vtype: "AIR", pattern: /^AIRCRAFT\b/u }
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
    const vtype = this.resolveVehicleMovementType({ section, handling });

    return {
      raw: row,
      name,
      normalizedName: this.normalizeComparableName(name),
      categoryLabel: section.label,
      gearType: section.gearType || this.gearTypeForSubtype(section.subtype),
      subtype: section.subtype,
      vtype,
      handling,
      handlOn,
      handlOff,
      accelRaw: accel,
      speedIntervalRaw: speedInterval,
      topSpeedRaw: topSpeed,
      bodyRaw: body,
      armorRaw: armor,
      pilotRaw: pilot,
      sensorRaw: sensor,
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
      .replace(/[\u00AD\uFFFE\uFFFD]/gu, "")
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
    return /^(?:\d+(?:\/\d+)*|[-–—])(?:\([A-Z]\))?$/iu.test(String(token ?? ""));
  }

  parseCost(rawCost) {
    const original = String(rawCost ?? "").trim();
    if (!original) return { price: 0, priceDef: 0 };

    const withoutCurrency = original.replace(/¥/gu, "").trim();
    if (/[()+x]/iu.test(withoutCurrency)) return { price: 0, priceDef: original };

    const firstPrice = withoutCurrency.split("/")[0] ?? withoutCurrency;
    const normalizedNumber = firstPrice.replace(/[,_\s]/gu, "");
    const value = Number(normalizedNumber);
    return {
      price: Number.isFinite(value) ? value : 0,
      priceDef: Number.isFinite(value) && !withoutCurrency.includes("/") ? value : original
    };
  }

  toNumber(value, fallback = 0) {
    const normalized = String(value ?? "").split("/")[0].replace(/,/gu, "").trim();
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
      TRUCKS: "Trucks and Vans",
      TRUCKS_AND_VANS: "Trucks and Vans",
      BOATS: "Boats",
      SUBMARINES: "Submarines",
      FIXED_WING: "Fixed-Wing Aircraft",
      ROTORCRAFT: "Rotorcraft",
      VTOL: "VTOL/VSTOL",
      AIRCRAFT: "Aircraft",
      MICRODRONES: "Microdrones",
      MINIDRONES: "Minidrones",
      SMALL_DRONES: "Small Drones",
      MEDIUM_DRONES: "Medium Drones",
      LARGE_DRONES: "Large Drones",
      DRONES: "Drones"
    };
    return labels[key] || "Vehicles";
  }

  vtypeForSubtype(subtype) {
    const key = this.normalizeSubtypeKey(subtype);
    if (key === "BOATS" || key === "SUBMARINES" || key === "PWC" || key === "SHIPS") return "WATER";
    if (key === "FIXED_WING" || key === "ROTORCRAFT" || key === "VTOL" || key === "AIRSHIP" || key === "AIRCRAFT") return "AIR";
    if (["MICRODRONES", "MINIDRONES", "SMALL_DRONES", "MEDIUM_DRONES", "LARGE_DRONES", "DRONES"].includes(key)) return "AUTO";
    return "GROUND";
  }

  gearTypeForSubtype(subtype) {
    const key = this.normalizeSubtypeKey(subtype);
    if (["MICRODRONES", "MINIDRONES", "SMALL_DRONES", "MEDIUM_DRONES", "LARGE_DRONES", "DRONES"].includes(key)) return "DRONES";
    return "VEHICLES";
  }

  resolveVehicleMovementType({ section = {}, handling = "" } = {}) {
    const fixed = String(section.vtype ?? "").toUpperCase();
    if (fixed === "GROUND" || fixed === "WATER" || fixed === "AIR") return fixed;

    // Core Rulebook drone rows use a split Handling value for ground drones
    // (on-road/off-road) and a single Handling value for flying drones.
    // There are no aquatic drones in the core vehicle table; future books can
    // still force WATER through a category override if needed.
    if (fixed === "AUTO" && String(handling ?? "").includes("/")) return "GROUND";
    if (fixed === "AUTO") return "AIR";

    return this.vtypeForSubtype(section.subtype);
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


  toFoundryActor({ name, description = "", row = null, accessories = "", warnings = [] } = {}) {
    const actorName = name || row?.name || "Unnamed Vehicle";
    const img = this.actorImageForRow(row);
    const condition = this.vehicleConditionMonitor(row?.body ?? 0);
    const tokenSize = this.tokenSizeForRow(row);

    return {
      name: actorName,
      type: "Vehicle",
      img,
      system: {
        physical: {
          base: condition,
          mod: 0,
          modString: "",
          value: condition,
          dmg: 0,
          max: condition * 2
        },
        stun: {
          base: condition,
          mod: 0,
          modString: "",
          value: condition,
          dmg: 0,
          max: condition * 2
        },
        overflow: {
          mod: 0,
          modString: "",
          value: 0,
          dmg: 0,
          max: 32
        },
        edge: {
          value: 0,
          max: 1
        },
        skills: {
          piloting: {
            points: 0,
            modifier: 0,
            pool: 0
          },
          evasion: {
            points: 0,
            modifier: 0,
            pool: 0
          },
          perception: {
            points: 0,
            modifier: 0,
            pool: 0
          },
          cracking: {
            points: 0,
            modifier: 0,
            pool: 0
          },
          stealth: {
            points: 0,
            modifier: 0,
            pool: 0
          }
        },
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
        vtype: this.actorVtypeForRow(row),
        vehicle: {
          belongs: "",
          opMode: "manual",
          offRoad: false,
          speed: 0
        },
        notes: this.actorNotesHtml({ row, description, accessories })
      },
      prototypeToken: this.toPrototypeToken({ name: actorName, img, width: tokenSize.width, height: tokenSize.height }),
      items: [],
      effects: [],
      folder: null,
      flags: {
        "shadowrun-items-importer": {
          documentType: "Actor",
          sourceParser: this.constructor.name,
          tableRow: row,
          category: row?.categoryLabel ?? "",
          warnings
        }
      }
    };
  }

  vehicleConditionMonitor(body) {
    const bodyValue = this.toNumber(body, 0);
    return 8 + Math.ceil(bodyValue / 2);
  }

  actorVtypeForRow(row) {
    const vtype = this.normalizeSubtypeKey(row?.vtype);

    if (vtype === "WATER") return "watercraft";
    if (vtype === "AIR") return "aircraft";
    return "ground_craft";
  }

  actorImageForRow(_row) {
    return "systems/shadowrun6-eden/icons/compendium/black-chrome/badger-corporate-bus.svg";
  }

  tokenSizeForRow(row) {
    const subtype = this.normalizeSubtypeKey(row?.subtype);
    if (subtype === "BIKES") return { width: 1, height: 2 };
    if (subtype === "TRUCKS" || subtype === "TRUCKS_AND_VANS") return { width: 3, height: 5 };
    if (subtype === "BOATS" || subtype === "SUBMARINES") return { width: 3, height: 6 };
    if (subtype === "FIXED_WING" || subtype === "ROTORCRAFT" || subtype === "VTOL" || subtype === "AIRCRAFT") return { width: 4, height: 4 };
    if (subtype === "MEDIUM_DRONES") return { width: 2, height: 2 };
    if (subtype === "LARGE_DRONES") return { width: 2, height: 3 };
    if (subtype.endsWith("DRONES") || subtype === "DRONES") return { width: 1, height: 1 };
    return { width: 2, height: 3 };
  }

  actorNotesHtml({ row = null, description = "", accessories = "" } = {}) {
    const parts = [];
    if (description) parts.push(description);
    if (accessories) parts.push(accessories);
    if (row?.raw) parts.push(`<p><strong>Vehicle table row:</strong> ${row.raw}</p>`);
    return parts.join("");
  }

  toPrototypeToken({ name, img, width, height }) {
    return {
      name,
      displayName: 20,
      actorLink: false,
      width,
      height,
      texture: {
        src: img,
        anchorX: 0.5,
        anchorY: 0.5,
        offsetX: 0,
        offsetY: 0,
        fit: "contain",
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        tint: "#ffffff",
        alphaThreshold: 0.75
      },
      lockRotation: false,
      rotation: 0,
      alpha: 1,
      disposition: 0,
      displayBars: 0,
      bar1: {
        attribute: "physical"
      },
      bar2: {
        attribute: "stun"
      },
      light: {
        negative: false,
        priority: 0,
        alpha: 0.5,
        angle: 360,
        bright: 0,
        color: null,
        coloration: 1,
        dim: 0,
        attenuation: 0.5,
        luminosity: 0.5,
        saturation: 0,
        contrast: 0,
        shadows: 0,
        animation: {
          type: null,
          speed: 5,
          intensity: 5,
          reverse: false
        },
        darkness: {
          min: 0,
          max: 1
        }
      },
      sight: {
        enabled: true,
        range: 0,
        angle: 360,
        visionMode: "basic",
        color: null,
        attenuation: 0.1,
        brightness: 0,
        saturation: 0,
        contrast: 0
      },
      detectionModes: [],
      occludable: {
        radius: 0
      },
      ring: {
        enabled: false,
        colors: {
          ring: null,
          background: null
        },
        effects: 1,
        subject: {
          scale: 1,
          texture: null
        }
      },
      turnMarker: {
        mode: 1,
        animation: null,
        src: null,
        disposition: false
      },
      movementAction: null,
      flags: {},
      randomImg: false,
      appendNumber: false,
      prependAdjective: false
    };
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
        type: row?.gearType || this.gearType || this.gearTypeForSubtype(this.requestedSubtype) || "VEHICLES",
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
          documentType: "Item",
          sourceParser: this.constructor.name,
          tableRow: row,
          category: row?.categoryLabel ?? "",
          warnings
        }
      }
    };
  }
}
