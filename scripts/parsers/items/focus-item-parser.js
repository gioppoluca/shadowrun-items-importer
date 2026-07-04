import { BaseItemParser } from "./base-item-parser.js";

export class FocusItemParser extends BaseItemParser {
  static ITEM_TYPE = "focus";
  static MAX_FORCE = 6;

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    const headerIndex = lines.findIndex((line) => this.isFocusHeader(line));
    const tableCandidateLines = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;
    const descriptionCandidateLines = headerIndex >= 0 ? lines.slice(0, headerIndex) : [];

    const rows = [];
    const trailingDescriptionLines = [];

    for (const line of tableCandidateLines) {
      const row = this.parseFocusRow(line);
      if (row) {
        rows.push(row);
      } else if (!this.isFocusHeader(line)) {
        trailingDescriptionLines.push(line);
      }
    }

    const descriptionLines = [...descriptionCandidateLines, ...trailingDescriptionLines];
    const descriptions = this.parseDescriptionSections(descriptionLines, rows);
    const items = [];
    const warnings = [];

    if (!rows.length) {
      ui.notifications?.warn("No focus table rows were found.");
      return [];
    }

    if (descriptions.length) {
      for (const section of descriptions) {
        const row = this.findRowForSection(section.name, rows);
        if (!row) {
          warnings.push(`Focus table row not found for "${section.name}". No items were created for that entry.`);
          continue;
        }

        items.push(...this.expandFocusRow(row, section.descriptionLines));
      }
    } else {
      for (const row of rows) {
        items.push(...this.expandFocusRow(row, []));
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

  isFocusHeader(line) {
    const normalized = String(line ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    return normalized.includes("TYPE")
      && normalized.includes("BONDING COST")
      && normalized.includes("AVAILABILITY")
      && normalized.includes("COST");
  }

  parseFocusRow(line) {
    const row = String(line ?? "").replace(/\s+/g, " ").trim();
    if (!row || this.isFocusHeader(row)) return null;

    // TYPE BONDING COST (IN KARMA) AVAILABILITY COST
    // Enchanting focus Force x 3 (Force) L Force x 5,000¥
    // Power focus Force x 6 (Force +3) L Force x 18,000¥
    const match = row.match(/^(.+?)\s+Force\s*[×x]\s*(\d+)\s+\((Force(?:\s*[+\-]\s*\d+)?)\)\s+([A-Z])\s+Force\s*[×x]\s*([\d,.]+)\s*¥?$/iu);
    if (!match) return null;

    return {
      raw: row,
      name: match[1].trim(),
      bondingMultiplier: Number(match[2]) || 0,
      availabilityExpression: match[3].trim(),
      legality: match[4].trim().toUpperCase(),
      costMultiplier: this.parseMoneyNumber(match[5])
    };
  }

  parseMoneyNumber(value) {
    const normalized = String(value ?? "")
      .replace(/,/g, "")
      .replace(/\s+/g, "")
      .trim();

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  expandFocusRow(row, descriptionLines = []) {
    const items = [];

    for (let force = 1; force <= FocusItemParser.MAX_FORCE; force += 1) {
      const bondingCostKarma = row.bondingMultiplier * force;
      const availability = this.resolveAvailability(row.availabilityExpression, force, row.legality);
      const cost = row.costMultiplier * force;

      items.push(this.toFoundryFocusItem({
        name: `${row.name} Force ${force}`,
        row,
        force,
        description: this.buildDescription(descriptionLines, row, {
          force,
          bondingCostKarma,
          availability,
          cost
        }),
        bondingCostKarma,
        availability,
        cost
      }));
    }

    return items;
  }

  resolveAvailability(expression, force, legality = "") {
    const raw = String(expression ?? "").trim();
    const modifierMatch = raw.match(/Force\s*([+\-])\s*(\d+)/iu);
    let value = Number(force) || 0;

    if (modifierMatch) {
      const sign = modifierMatch[1] === "-" ? -1 : 1;
      value += sign * Number(modifierMatch[2]);
    }

    const suffix = legality ? `(${legality})` : "";
    return {
      avail: value,
      availDef: `${value}${suffix}`,
      formula: raw,
      legality
    };
  }

  buildDescription(descriptionLines = [], row, computed) {
    const body = this.joinWrappedText(descriptionLines);
    const meta = [
      `<p><strong>Force:</strong> ${computed.force}</p>`,
      `<p><strong>Bonding Cost:</strong> ${computed.bondingCostKarma} Karma</p>`,
      `<p><strong>Availability:</strong> ${computed.availability.availDef}</p>`,
      `<p><strong>Cost:</strong> ${this.formatNuyen(computed.cost)}</p>`,
      `<p><strong>Focus table row:</strong> ${row.raw}</p>`
    ];

    return `${body ? `<p>${body}</p>` : ""}${meta.join("")}`;
  }

  formatNuyen(value) {
    const amount = Number(value) || 0;
    return `${amount.toLocaleString("en-US")}¥`;
  }

  parseDescriptionSections(lines = [], rows = []) {
    const rowNames = new Set(rows.map((row) => this.normalizeMatchName(row.name)));
    const sections = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      sections.push(current);
      current = null;
    };

    for (const line of lines) {
      const clean = String(line ?? "").trim();
      if (!clean || this.isFocusHeader(clean) || this.parseFocusRow(clean)) continue;

      if (rowNames.has(this.normalizeMatchName(clean))) {
        flush();
        current = { name: clean, descriptionLines: [] };
      } else if (current) {
        current.descriptionLines.push(clean);
      }
    }

    flush();
    return sections;
  }

  findRowForSection(sectionName, rows = []) {
    const wanted = this.normalizeMatchName(sectionName);
    if (!wanted) return null;

    return rows.find((row) => this.normalizeMatchName(row.name) === wanted)
      ?? rows.find((row) => this.normalizeMatchName(row.name).startsWith(wanted))
      ?? rows.find((row) => wanted.startsWith(this.normalizeMatchName(row.name)))
      ?? null;
  }

  normalizeMatchName(name) {
    return String(name ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  joinWrappedText(lines = []) {
    return lines
      .map((line) => String(line ?? "").trim())
      .filter((line) => line.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  toFoundryFocusItem({ name, row, force, description, bondingCostKarma, availability, cost }) {
    return {
      name: name || "Unnamed Focus",
      type: "focus",
      img: "systems/shadowrun6-eden/icons/compendium/clothing/generic_jewelry.svg",
      system: {
        genesisID: "",
        description: description ?? "",
        product: "",
        page: 0,
        rating: Number(force) || 0
      },
      effects: [],
      folder: this.folderId ?? null,
      flags: {
        "shadowrun-items-importer": {
          focus: {
            sourceRow: row.raw,
            force: Number(force) || 0,
            bondingCostKarma,
            availabilityFormula: row.availabilityExpression,
            avail: availability.avail,
            availDef: availability.availDef,
            legality: availability.legality,
            cost,
            costDef: this.formatNuyen(cost)
          }
        }
      }
    };
  }
}
