import { BaseItemParser } from "../base-item-parser.js";

/**
 * Shared cyberware parser infrastructure.
 *
 * Cyberware differs from normal gear because each parsed base item can expand to
 * multiple Foundry items:
 *   - one standard-grade item using the printed values;
 *   - one item for each cyberware grade from the grade modifier table;
 *   - optionally one set per rating when the table row contains a rating range.
 *
 * The grade table is intentionally kept here instead of hidden inside the
 * concrete parser. This keeps the rule visible and prevents future parsers
 * (eyeware, bodyware, etc.) from reimplementing slightly different grade math.
 */
export class BaseCyberwareParser extends BaseItemParser {
  static GRADES = [
    { key: "standard", label: "", essenceMultiplier: 1, costMultiplier: 1, availabilityModifier: 0 },
    { key: "used", label: "Used", essenceMultiplier: 1.1, costMultiplier: 0.5, availabilityModifier: -1 },
    { key: "alphaware", label: "Alphaware", essenceMultiplier: 0.8, costMultiplier: 1.2, availabilityModifier: 1 },
    { key: "betaware", label: "Betaware", essenceMultiplier: 0.7, costMultiplier: 1.5, availabilityModifier: 2 },
    { key: "deltaware", label: "Deltaware", essenceMultiplier: 0.5, costMultiplier: 2.5, availabilityModifier: 3 }
  ];

  getCyberwareSubtype() {
    return "CYBERWARE";
  }

  parsePrice(rawCost, rating = 0) {
    const raw = String(rawCost ?? "").trim();
    if (!raw) return { price: 0, priceDef: "" };

    const normalized = raw
      .replace(/¥/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const ratingValue = Number(rating) || 0;
    let expression = normalized
      .replace(/,/g, "")
      .replace(/\brating\b/gi, String(ratingValue))
      .replace(/\^/g, "**")
      .replace(/[×x]/gi, "*");

    // Costs such as "5,000¥ + cyberdeck" or "2,000¥ + Commlink" contain a
    // required external item. We keep the full printed value in priceDef and use
    // the numeric nuyen part as the base price.
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

  parseEssence(rawEssence, rating = 0) {
    const raw = String(rawEssence ?? "").trim();
    if (!raw || raw === "—" || raw === "-") return 0;

    const ratingValue = Number(rating) || 0;
    const expression = raw
      .replace(/,/g, ".")
      .replace(/\brating\b/gi, String(ratingValue))
      .replace(/[×x]/gi, "*")
      .replace(/\^/g, "**");

    if (/[^\d+\-*/().\s]/u.test(expression)) return this.extractFirstDecimal(raw, 0);

    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${expression});`)();
      return Number.isFinite(value) ? value : 0;
    } catch (_error) {
      return this.extractFirstDecimal(raw, 0);
    }
  }

  extractFirstDecimal(text, fallback = 0) {
    const match = String(text ?? "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : fallback;
  }

  parseCapacity(rawCapacity) {
    const raw = String(rawCapacity ?? "").trim();
    if (!raw || raw === "—" || raw === "-") return 0;
    return this.extractFirstInteger(raw, 0);
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

  applyGradeAvailability(rawAvail, grade) {
    const parsed = this.parseAvailability(rawAvail);
    if (!parsed.availDef && !parsed.avail) return { avail: 0, availDef: "" };

    const finalAvail = Math.max(0, parsed.avail + grade.availabilityModifier);
    return {
      avail: finalAvail,
      availDef: `${finalAvail}${parsed.suffix}`
    };
  }

  formatEssence(value) {
    const rounded = Math.round((Number(value) || 0) * 1000) / 1000;
    return Number.isInteger(rounded) ? rounded : Number(rounded.toFixed(3));
  }

  buildCyberwareName(baseName, rating, grade) {
    const ratingPart = rating ? ` Rating ${rating}` : "";
    const gradePart = grade.label ? ` - ${grade.label}` : "";
    return `${baseName}${ratingPart}${gradePart}`;
  }

  buildDescription(descriptionLines = [], row = null, grade = null, rating = 0) {
    const body = this.joinWrappedText(descriptionLines);
    const meta = [];

    if (row) {
      meta.push(`<p><strong>Cyberware table row:</strong> ${row.raw}</p>`);
    }

    if (rating) {
      meta.push(`<p><strong>Rating:</strong> ${rating}</p>`);
    }

    if (grade?.label) {
      meta.push(`<p><strong>Grade:</strong> ${grade.label}</p>`);
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

  expandCyberwareItem({ baseName, descriptionLines, row }) {
    const ratingRange = this.extractRatingRange(row.name);
    const cleanName = this.cleanCyberwareName(row.name || baseName);
    const ratings = ratingRange
      ? Array.from({ length: ratingRange.max - ratingRange.min + 1 }, (_v, i) => ratingRange.min + i)
      : [0];

    const items = [];

    for (const rating of ratings) {
      const baseEssence = this.parseEssence(row.essence, rating);
      const basePrice = this.parsePrice(row.cost, rating);
      const capacity = this.parseCapacity(row.capacity);

      for (const grade of BaseCyberwareParser.GRADES) {
        const price = Math.round(basePrice.price * grade.costMultiplier);
        const essence = this.formatEssence(baseEssence * grade.essenceMultiplier);
        const availability = this.applyGradeAvailability(row.availability, grade);

        items.push(this.toCyberwareFoundryItem({
          name: this.buildCyberwareName(cleanName, rating, grade),
          description: this.buildDescription(descriptionLines, row, grade, rating),
          row,
          rating,
          grade,
          essence,
          capacity,
          price,
          priceDef: basePrice.priceDef,
          avail: availability.avail,
          availDef: availability.availDef
        }));
      }
    }

    return items;
  }

  extractRatingRange(name) {
    const match = String(name ?? "").match(/\((?:rating\s*)?(\d+)\s*[–-]\s*(\d+)\)/i);
    if (!match) return null;

    const min = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
    return { min, max };
  }

  cleanCyberwareName(name) {
    return String(name ?? "")
      .replace(/\s*\((?:rating\s*)?\d+\s*[–-]\s*\d+\)\s*/i, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  toCyberwareFoundryItem({ name, description, rating, essence, capacity, price, priceDef, avail, availDef }) {
    return {
      name: name || "Unnamed Cyberware",
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
        // The Shadowrun 6 Eden sheet uses priceDef as the displayed/evaluated
        // cost definition. For generated cyberware variants we have already
        // resolved rating formulas and grade multipliers, so priceDef must be
        // the final numeric price too. Keeping the printed source value here
        // (for example "4,000¥") makes the system interpret the comma as a
        // decimal separator in some contexts, so Simrig appeared as cost 4 and
        // grade multipliers seemed to do nothing. The original printed row is
        // still preserved in the item description by buildDescription().
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
        essence: Number.isFinite(essence) ? essence : 0,
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
