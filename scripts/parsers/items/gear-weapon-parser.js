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
  static MAX_PROJECTILE_RATING = 10;

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
    const afterHeaderLines = lines.slice(headerIndex + 1);
    const { tableLines, trailingLines } = this.splitWeaponTableLines(afterHeaderLines, headerInfo);
    const tableRows = this.parseWeaponRows(tableLines, headerInfo);

    // PDF/text extraction can place the shared statistics table either after the
    // prose blocks (the original supported layout) or before them. Parse both
    // sides and select the set whose names actually match the table rows.
    const introBlocks = this.parseRequestedWeaponBlocks(introLines, { fallbackUnnamed: false });
    const trailingBlocks = this.parseRequestedWeaponBlocks(trailingLines, { fallbackUnnamed: false });
    const wantedBlocks = this.selectRequestedWeaponBlocks(introBlocks, trailingBlocks, tableRows, headerInfo);

    const items = [];
    const emittedKeys = new Set();

    for (const [blockIndex, block] of wantedBlocks.entries()) {
      const rows = this.findMatchingRows(block.name, tableRows, headerInfo, blockIndex);
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

        items.push(...this.expandWeaponRow({
          name: headerInfo.hasTypeColumn ? block.name : row.name,
          description,
          row,
          warnings: []
        }));
      }
    }

    return items.length === 1 ? items[0] : items;
  }

  findWeaponTableHeaderIndex(lines) {
    return lines.findIndex((line) => this.isWeaponTableHeader(line));
  }

  isWeaponTableHeader(line) {
    return /^(?:WEAPON(?:\s+TYPE)?|TYPE)\s+DV\b/i.test(String(line ?? "").trim());
  }

  parseHeader(header) {
    const trimmed = String(header ?? "").trim();
    const normalized = trimmed.toUpperCase();
    return {
      // "WEAPON DV ..." and "WEAPON TYPE DV ..." both identify the first
      // column as the actual item name.
      hasWeaponColumn: /^WEAPON(?:\s+TYPE)?\s+DV\b/i.test(trimmed),
      // A table beginning with "TYPE DV ..." uses TYPE as the name column.
      // Keep this separate from the additional TYPE column in
      // "WEAPON TYPE DV ..." because the latter contains a skill/category
      // value such as Unarmed or Exotic.
      hasTypeColumn: /^TYPE\s+DV\b/i.test(trimmed),
      hasWeaponTypeColumn: /^WEAPON\s+TYPE\s+DV\b/i.test(trimmed),
      hasModes: /\bMODES?\b/.test(normalized),
      hasAmmo: /\bAMMO\b/.test(normalized)
    };
  }

  parseRequestedWeaponBlocks(lines, { fallbackUnnamed = true } = {}) {
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

    if (blocks.length) return blocks;
    return fallbackUnnamed ? [{ name: "Unnamed Weapon", descriptionLines: [] }] : [];
  }

  /**
   * Separates the table rows from prose that was extracted after the table.
   *
   * A weapon row can wrap over several lines, but its final cost always ends in
   * the nuyen symbol. We only advance the table boundary when the accumulated
   * text ending in ¥ parses as a valid row. Any remaining lines are therefore
   * available as trailing weapon description blocks.
   */
  splitWeaponTableLines(lines, headerInfo) {
    const sourceLines = Array.isArray(lines) ? lines : [];
    let buffer = [];
    let lastValidRowEnd = -1;
    let foundRow = false;

    for (let index = 0; index < sourceLines.length; index += 1) {
      const cleaned = String(sourceLines[index] ?? "").trim();
      if (!cleaned) continue;
      if (this.isWeaponTableHeader(cleaned)) continue;

      buffer.push(cleaned);
      if (!this.isPotentialWeaponRowEnd(cleaned)) continue;

      const parsed = this.parseWeaponRow(buffer.join(" "), headerInfo);
      if (this.isCompleteWeaponRow(parsed)) {
        foundRow = true;
        lastValidRowEnd = index;
        buffer = [];
        continue;
      }

      // A wrapped row may temporarily end in an em dash because the final
      // Attack Rating, availability, or cost was extracted onto another line.
      // Keep accumulating until a complete row is recognized. Prose following
      // the table is harmless here: lastValidRowEnd remains on the last row.
    }

    if (lastValidRowEnd < 0) {
      return { tableLines: sourceLines, trailingLines: [] };
    }

    return {
      tableLines: sourceLines.slice(0, lastValidRowEnd + 1),
      trailingLines: sourceLines.slice(lastValidRowEnd + 1)
    };
  }

  selectRequestedWeaponBlocks(introBlocks, trailingBlocks, rows, headerInfo) {
    const before = Array.isArray(introBlocks) ? introBlocks : [];
    const after = Array.isArray(trailingBlocks) ? trailingBlocks : [];

    if (!before.length && !after.length) {
      return [{ name: "Unnamed Weapon", descriptionLines: [] }];
    }
    if (!before.length) return after;
    if (!after.length) return before;

    const beforeScore = this.scoreRequestedWeaponBlocks(before, rows, headerInfo);
    const afterScore = this.scoreRequestedWeaponBlocks(after, rows, headerInfo);

    if (afterScore > beforeScore) return after;
    return before;
  }

  scoreRequestedWeaponBlocks(blocks, rows, headerInfo) {
    if (!headerInfo?.hasWeaponColumn) return 0;

    return blocks.reduce((score, block) => {
      const wanted = this.normalizeComparableName(block?.name);
      if (!wanted) return score;

      const exactCount = rows.filter((row) =>
        row.normalizedName === wanted || row.normalizedGroupName === wanted
      ).length;
      if (exactCount) return score + (exactCount * 100);

      const seriesCount = this.findSeriesRows(block?.name, rows).length;
      if (seriesCount) return score + (seriesCount * 50);

      const looseCount = rows.filter((row) =>
        row.normalizedName.includes(wanted) || wanted.includes(row.normalizedName)
      ).length;
      return score + (looseCount * 10);
    }, 0);
  }

  parseWeaponRows(tableLines, headerInfo) {
    const rows = [];
    let buffer = [];

    for (const line of tableLines) {
      const cleaned = String(line ?? "").trim();
      if (!cleaned) continue;
      if (this.isWeaponTableHeader(cleaned)) continue;

      buffer.push(cleaned);

      if (this.isPotentialWeaponRowEnd(cleaned)) {
        const rawRow = buffer.join(" ");
        const parsed = this.parseWeaponRow(rawRow, headerInfo);
        if (this.isCompleteWeaponRow(parsed)) {
          rows.push(...this.expandCombinedWeaponRows(parsed));
          buffer = [];
        }
      }
    }

    if (buffer.length) {
      const parsed = this.parseWeaponRow(buffer.join(" "), headerInfo);
      if (this.isCompleteWeaponRow(parsed)) rows.push(...this.expandCombinedWeaponRows(parsed));
    }

    return rows;
  }

  /**
   * Weapon rows normally end in a nuyen price. Integrated weapon components
   * (for example the Ares Alpha grenade launcher) instead use em dashes for
   * both availability and cost. A dash can also occur earlier in a wrapped row,
   * so this method only marks a possible boundary; isCompleteWeaponRow performs
   * the final validation after parsing the accumulated text.
   */
  isPotentialWeaponRowEnd(line) {
    return /(?:¥|[-–—])\s*$/u.test(String(line ?? "").trim());
  }

  isCompleteWeaponRow(row) {
    if (!row) return false;
    const cost = String(row.cost ?? "").trim();
    return /¥\s*$/u.test(cost) || /^[-–—]$/u.test(cost);
  }

  parseWeaponRow(rawRow, headerInfo) {
    const normalized = this.normalizeTableRow(rawRow);
    const tokens = normalized.split(/\s+/u).filter(Boolean);

    const availabilityIndex = this.findAvailabilityIndex(tokens);
    if (availabilityIndex < 0) return null;

    const availability = tokens[availabilityIndex] ?? "";
    const cost = tokens.slice(availabilityIndex + 1).join(" ");
    const left = tokens.slice(0, availabilityIndex);

    let identityAndDamage = null;
    let modes = "";
    let ammo = "";
    let attackRatings = "";

    if (headerInfo.hasModes) {
      // Firearm tables are most reliably parsed around the MODES column. This
      // avoids confusing textual DV values with weapon-name words, for example:
      //   Streetline Special 2P SS ...        ("Special" is part of the name)
      //   Ares Super Squirt Special SS ...    ("Special" is the DV)
      //   Parashield DART Pistol 1P + special SS ...
      const modeIndex = left.findIndex((token) => this.looksLikeModeToken(token));
      if (modeIndex < 0) return null;

      modes = left[modeIndex];
      identityAndDamage = this.parseWeaponIdentityAndDamage(
        left.slice(0, modeIndex).join(" "),
        headerInfo
      );
      if (!identityAndDamage) return null;

      const afterMode = left.slice(modeIndex + 1);
      if (!afterMode.length) return null;

      // Attack Ratings are normalized to one slash-delimited token. Everything
      // after that token belongs to AMMO, which also supports definitions such
      // as "50(c) or 100(belt)" without changing the row boundary logic.
      attackRatings = afterMode.shift() ?? "";
      if (headerInfo.hasAmmo) ammo = afterMode.join(" ");
      else if (afterMode.length) attackRatings = [attackRatings, ...afterMode].join(" ");
    } else {
      // Melee and projectile tables do not have a MODES anchor. Preserve their
      // established parsing path while sharing the expanded DV grammar.
      const rowMatch = normalized.match(this.weaponRowWithoutModesPattern());
      if (!rowMatch) return null;

      const identity = this.parseWeaponIdentity(rowMatch[1], headerInfo);
      if (!identity.name) return null;

      identityAndDamage = {
        name: identity.name,
        weaponType: identity.weaponType,
        dv: rowMatch[2].trim()
      };

      const remainingTokens = rowMatch[3].trim().split(/\s+/u).filter(Boolean);
      const remainingAvailabilityIndex = this.findAvailabilityIndex(remainingTokens);
      if (remainingAvailabilityIndex < 0) return null;

      const remainingLeft = remainingTokens.slice(0, remainingAvailabilityIndex);
      if (headerInfo.hasAmmo && remainingLeft.length) ammo = remainingLeft.pop();
      attackRatings = remainingLeft.join(" ").replace(/\s+/g, " ").trim();
    }

    return {
      raw: normalized,
      name: identityAndDamage.name,
      weaponType: identityAndDamage.weaponType,
      normalizedName: this.normalizeComparableName(identityAndDamage.name),
      dv: identityAndDamage.dv,
      modes,
      attackRatings,
      ammo,
      availability,
      cost
    };
  }

  /**
   * Splits the text before a firearm MODES column into weapon identity and DV.
   *
   * Besides normal values such as 3P and 4S(e), SR6 tables use textual and
   * compound damage definitions including "Special", "As grenade", and
   * "1P + special". Matching from the end keeps words such as "Special" in a
   * weapon name when a conventional DV follows them.
   */
  parseWeaponIdentityAndDamage(rawPrefix, headerInfo = {}) {
    const source = String(rawPrefix ?? "").trim();
    if (!source) return null;

    const match = source.match(new RegExp(
      `^(.+?)\\s+(${this.weaponDamagePatternSource()})$`,
      "iu"
    ));
    if (!match) return null;

    const identity = this.parseWeaponIdentity(match[1], headerInfo);
    if (!identity.name) return null;

    return {
      name: identity.name,
      weaponType: identity.weaponType,
      dv: match[2].trim()
    };
  }

  weaponDamagePatternSource() {
    const numericDamage = String.raw`(?:\([^)]*Rating[^)]*\)|\(?Rating(?:\/\d+)?\)?|\d+)[PS](?:\([^)]*\))*`;
    return String.raw`(?:As\s+(?:Grenade|Missile)|${numericDamage}(?:\s+\+\s+special)?|Grenade|Missile|Special|[-–—])`;
  }

  weaponRowWithoutModesPattern() {
    return new RegExp(
      `^(.+?)\\s+(${this.weaponDamagePatternSource()})\\s+(.+)$`,
      "iu"
    );
  }

  /**
   * Keeps compact slash-form firearm entries as one source item.
   *
   * The core-rulebook row
   *   Colt Government 2076/Manhunter ... 275¥/500¥
   * is a single weapon entry with alternate commercial configuration/pricing,
   * not two independent table rows. Preserve both the slash-form name and the
   * original price definition so the importer creates exactly one Foundry item.
   */
  expandCombinedWeaponRows(row) {
    return row ? [row] : [];
  }

  /**
   * Parses the columns that occur before DV.
   *
   * Supported layouts:
   *   WEAPON DV ...       -> "Combat axe"
   *   TYPE DV ...         -> "Throwing knife"
   *   WEAPON TYPE DV ...  -> "Bike chain" + "Unarmed"
   *
   * In the additional TYPE-column layout, Shadowrun uses one-word values such
   * as Unarmed and Exotic. Known values are preferred, with a final-token
   * fallback so custom tables remain importable.
   */
  parseWeaponIdentity(rawIdentity, headerInfo = {}) {
    const identity = String(rawIdentity ?? "").trim();
    if (!identity) return { name: "", weaponType: "" };

    if (!headerInfo.hasWeaponTypeColumn) {
      const name = this.cleanWeaponName(identity);
      return {
        name,
        weaponType: headerInfo.hasTypeColumn ? name : ""
      };
    }

    const knownTypeMatch = identity.match(/^(.+?)\s+(Unarmed|Exotic)$/iu);
    if (knownTypeMatch) {
      return {
        name: this.cleanWeaponName(knownTypeMatch[1]),
        weaponType: knownTypeMatch[2].trim()
      };
    }

    const fallbackMatch = identity.match(/^(.+?)\s+(\S+)$/u);
    if (!fallbackMatch) return { name: this.cleanWeaponName(identity), weaponType: "" };

    return {
      name: this.cleanWeaponName(fallbackMatch[1]),
      weaponType: fallbackMatch[2].trim()
    };
  }

  cleanWeaponName(name) {
    return String(name ?? "")
      .replace(/\*+$/u, "")
      .trim();
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
      const hasNuyenCost = /¥\s*$/u.test(costCandidate);
      const hasUnavailableCost = /^[-–—]$/u.test(costCandidate);
      if (!hasNuyenCost && !hasUnavailableCost) continue;
      // A numeric token can be part of a formula cost, e.g.
      // "(Rating/3)(L) 100 + (rating x 10)¥". In that case the
      // real availability is the token before the cost formula, not "100".
      if (hasNuyenCost && /^[+)x]/iu.test(costCandidate)) continue;
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

  findMatchingRows(name, rows, headerInfo = {}, blockIndex = 0) {
    if (headerInfo.hasTypeColumn && !headerInfo.hasWeaponColumn) {
      if (rows.length === 1) return rows;
      return rows[blockIndex] ? [rows[blockIndex]] : [];
    }

    const wanted = this.normalizeComparableName(name);
    if (!wanted) return [];

    const exact = rows.filter((row) =>
      row.normalizedName === wanted || row.normalizedGroupName === wanted
    );
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
   * Expands rating-based projectile rows into ready-to-use Foundry items.
   *
   * This behavior is intentionally limited to WEAPON_RANGED. Other weapon
   * categories retain the normal single-item behavior even when their prose or
   * notes happen to contain the word "rating".
   */
  expandWeaponRow({ name, description = "", row = null, warnings = [] } = {}) {
    if (!this.shouldExpandProjectileRating(row)) {
      return [this.toFoundryItem({ name, description, row, warnings })];
    }

    const { min, max } = this.projectileRatingRange(row);
    const items = [];

    for (let rating = min; rating <= max; rating += 1) {
      const ratedRow = this.resolveProjectileRatingRow(row, rating);
      items.push(this.toFoundryItem({
        name: `${name || row?.name || "Unnamed Weapon"} (Rating ${rating})`,
        description,
        row: ratedRow,
        rating,
        needsRating: true,
        warnings
      }));
    }

    return items;
  }

  shouldExpandProjectileRating(row) {
    if (String(this.gearType ?? "").toUpperCase() !== "WEAPON_RANGED") return false;
    if (!row) return false;

    return /rating/iu.test([
      row.dv,
      row.attackRatings,
      row.availability,
      row.cost
    ].join(" "));
  }

  projectileRatingRange(row) {
    const name = this.normalizeComparableName(row?.name);
    const min = name.includes("injection arrow") ? 8 : 1;

    return {
      min,
      max: GearWeaponParser.MAX_PROJECTILE_RATING
    };
  }

  resolveProjectileRatingRow(row, rating) {
    const formulas = {
      dv: row?.dv ?? "",
      attackRatings: row?.attackRatings ?? "",
      availability: row?.availability ?? "",
      cost: row?.cost ?? ""
    };

    return {
      ...row,
      dv: this.resolveDamageForRating(formulas.dv, rating),
      attackRatings: this.resolveAttackRatingsForRating(formulas.attackRatings, rating),
      availability: this.resolveAvailabilityForRating(formulas.availability, rating),
      cost: this.resolveCostForRating(formulas.cost, rating),
      rating,
      formulas
    };
  }

  resolveDamageForRating(rawDamage, rating) {
    const source = String(rawDamage ?? "").trim();
    if (!/rating/iu.test(source)) return source;

    const match = source.match(/^(.+?)([PS])((?:\(e\))?)$/iu);
    if (!match) return source;

    const value = this.evaluateRoundedRatingFormula(match[1], rating);
    if (value === null) return source;

    return `${value}${match[2].toUpperCase()}${match[3] ?? ""}`;
  }

  resolveAttackRatingsForRating(rawAttackRatings, rating) {
    const source = String(rawAttackRatings ?? "").trim();
    if (!/rating/iu.test(source)) return source;

    return this.splitTopLevel(source, "/")
      .map((part) => {
        const cleaned = String(part ?? "").trim();
        if (!/rating/iu.test(cleaned)) return cleaned;

        const value = this.evaluateRoundedRatingFormula(cleaned, rating);
        return value === null ? cleaned : String(value);
      })
      .join("/");
  }

  resolveAvailabilityForRating(rawAvailability, rating) {
    const source = String(rawAvailability ?? "").trim();
    if (!/rating/iu.test(source)) return source;

    const legalityMatch = source.match(/^(.*?)(?:\(([A-Z])\))?$/u);
    const expression = legalityMatch?.[1]?.trim() ?? source;
    const legality = legalityMatch?.[2] ?? "";
    const value = this.evaluateRoundedRatingFormula(expression, rating);
    if (value === null) return source;

    return `${value}${legality ? `(${legality})` : ""}`;
  }

  resolveCostForRating(rawCost, rating) {
    const source = String(rawCost ?? "").trim();
    if (!/rating/iu.test(source)) return source;

    const value = this.evaluateRatingFormula(source, rating);
    if (value === null) return source;

    return `${Math.round(value)}¥`;
  }

  evaluateRoundedRatingFormula(expression, rating) {
    const value = this.evaluateRatingFormula(expression, rating);
    return value === null ? null : Math.ceil(value);
  }

  /**
   * Safely evaluates the small arithmetic expressions used by SR6 rating rows.
   * Supported operators are +, -, multiplication (x/×/*), division and
   * parentheses. No JavaScript evaluation is used.
   */
  evaluateRatingFormula(expression, rating) {
    const ratingValue = Number(rating);
    if (!Number.isFinite(ratingValue)) return null;

    const normalized = String(expression ?? "")
      .replace(/¥/gu, "")
      .replace(/,/gu, "")
      .replace(/\bRating\b/giu, String(ratingValue))
      .replace(/[x×]/giu, "*")
      .replace(/\s+/gu, "")
      .trim();

    if (!normalized || !/^[0-9()+\-*/.]+$/u.test(normalized)) return null;

    const tokens = normalized.match(/\d+(?:\.\d+)?|[()+\-*/]/gu) ?? [];
    if (!tokens.length || tokens.join("") !== normalized) return null;

    let position = 0;

    const parseExpression = () => {
      let value = parseTerm();
      if (value === null) return null;

      while (tokens[position] === "+" || tokens[position] === "-") {
        const operator = tokens[position];
        position += 1;
        const right = parseTerm();
        if (right === null) return null;
        value = operator === "+" ? value + right : value - right;
      }

      return value;
    };

    const parseTerm = () => {
      let value = parseFactor();
      if (value === null) return null;

      while (tokens[position] === "*" || tokens[position] === "/") {
        const operator = tokens[position];
        position += 1;
        const right = parseFactor();
        if (right === null || (operator === "/" && right === 0)) return null;
        value = operator === "*" ? value * right : value / right;
      }

      return value;
    };

    const parseFactor = () => {
      const token = tokens[position];
      if (token === "+" || token === "-") {
        position += 1;
        const value = parseFactor();
        if (value === null) return null;
        return token === "-" ? -value : value;
      }

      if (token === "(") {
        position += 1;
        const value = parseExpression();
        if (value === null || tokens[position] !== ")") return null;
        position += 1;
        return value;
      }

      if (!/^\d+(?:\.\d+)?$/u.test(String(token ?? ""))) return null;
      position += 1;
      return Number(token);
    };

    const result = parseExpression();
    if (result === null || position !== tokens.length || !Number.isFinite(result)) return null;
    return result;
  }

  splitTopLevel(value, separator = "/") {
    const source = String(value ?? "");
    const parts = [];
    let current = "";
    let depth = 0;

    for (const character of source) {
      if (character === "(") depth += 1;
      if (character === ")" && depth > 0) depth -= 1;

      if (character === separator && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += character;
      }
    }

    parts.push(current);
    return parts;
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
    const parts = this.splitTopLevel(String(value ?? ""), "/")
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

  inferSkill(row = null) {
    const tableType = String(row?.weaponType ?? "").trim().toLowerCase();
    if (tableType === "unarmed") return "close_combat";
    if (tableType === "exotic") return "exotic_weapons";

    if (this.gearType === "WEAPON_FIREARMS") return "firearms";
    if (this.gearType === "WEAPON_CLOSE_COMBAT") return "close_combat";
    if (this.gearType === "WEAPON_RANGED" || this.gearType === "WEAPON_PROJECTILE_THROWN") return "athletics";
    return "";
  }

  inferSkillSpec(row = null) {
    const tableType = String(row?.weaponType ?? "").trim().toLowerCase();
    if (tableType === "unarmed") return "unarmed";
    if (tableType === "exotic") {
      return /whips?\b/iu.test(String(row?.name ?? "")) ? "whips" : "other";
    }

    return String(this.gearSubtype ?? "").toLowerCase();
  }

  toFoundryItem({
    name,
    description = "",
    row = null,
    rating = 0,
    needsRating = null,
    warnings = []
  } = {}) {
    const dv = row?.dv ?? "";
    const damageNumber = this.extractFirstInteger(dv, 0);
    const damageType = String(dv).match(/(?:\d|\))([PS])(?=\b|\()/iu)?.[1]?.toUpperCase() ?? "";
    const isStun = damageType === "S";
    const parsedCost = this.parseCost(row?.cost);
    const formulaSource = row?.formulas ?? {};
    const resolvedNeedsRating = needsRating ?? Boolean(
      row && /rating/i.test(`${row.dv} ${row.attackRatings} ${row.availability} ${row.cost}`)
    );

    const notes = row
      ? [
          row.raw ? `<p><strong>Imported table row:</strong> ${row.raw}</p>` : "",
          rating ? `<p><strong>Resolved rating:</strong> ${rating}</p>` : "",
          formulaSource.dv && /rating/i.test(formulaSource.dv) ? `<p><strong>Damage formula:</strong> ${formulaSource.dv}</p>` : "",
          formulaSource.attackRatings && /rating/i.test(formulaSource.attackRatings) ? `<p><strong>Attack ratings formula:</strong> ${formulaSource.attackRatings}</p>` : "",
          formulaSource.availability && /rating/i.test(formulaSource.availability) ? `<p><strong>Availability formula:</strong> ${formulaSource.availability}</p>` : "",
          formulaSource.cost && /rating/i.test(formulaSource.cost) ? `<p><strong>Cost formula:</strong> ${formulaSource.cost}</p>` : "",
          !row.formulas && row.attackRatings && /rating/i.test(row.attackRatings) ? `<p><strong>Attack ratings formula:</strong> ${row.attackRatings}</p>` : "",
          row.weaponType ? `<p><strong>Weapon type:</strong> ${row.weaponType}</p>` : "",
          row.groupName ? `<p><strong>Combined source entry:</strong> ${row.groupName}</p>` : "",
          !row.formulas && row.cost && /rating/i.test(row.cost) ? `<p><strong>Cost formula:</strong> ${row.cost}</p>` : ""
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
        needsRating: resolvedNeedsRating,
        rating: Number(rating) || 0,
        skill: this.inferSkill(row),
        skillSpec: this.inferSkillSpec(row),
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
