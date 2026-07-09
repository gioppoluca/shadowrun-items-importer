import { SII } from "../../constants.js";
import { CritterStatblockParser } from "./critter-statblock-parser.js";

/**
 * Parser for Shadowrun 6 Eden spirit stat blocks.
 *
 * Supported shape:
 *   SPIRITS OF AIR
 *   B A R S W L I C M ESS
 *   F–2 F+3 F+4 F–3 F F F F F F
 *   AC CM MOVE
 *   A1, I3 (F/2)+8 5/10/+5
 *   Initiative: [(F x 2) + 4] + 2D6
 *   Astral Initiative: (F x 2) + 3D6
 *   Defense Rating: F – 2
 *   Skills: Astral, Athletics, Close Combat, Exotic Ranged Weapon, Perception
 *   Powers: ...
 *   Optional Powers: ...
 *   Attacks:
 *   Elemental Attack [DV (F)P, Attack Ratings ...]
 */
export class SpiritStatblockParser extends CritterStatblockParser {
  constructor({ text, type = "actor.Spirit.force.1", folderId = null } = {}) {
    super({ text, type, folderId });
    this.force = this.forceFromType(type);
  }

  forceFromType(type) {
    const match = String(type ?? "").match(/(?:force[._:-]?|actor\.spirit\.)(\d+)$/iu)
      || String(type ?? "").match(/\bforce\D*(\d+)\b/iu);
    const force = match ? Number(match[1]) : 0;
    if (!Number.isInteger(force) || force < 1) {
      throw new Error("Spirit import requires a numeric Force greater than zero.");
    }
    return force;
  }

  parse() {
    if (!this.text) {
      ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.missingInput`));
      return null;
    }

    const lines = this.splitLines();
    const primaryHeaderIndex = lines.findIndex((line) => this.isPrimaryAttributeHeader(line));
    if (primaryHeaderIndex <= 0) {
      throw new Error("Could not find Spirit primary attribute header: B A R S W L I C M ESS");
    }

    const secondaryHeaderIndex = lines.findIndex((line, index) => index > primaryHeaderIndex && this.isSecondaryStatHeader(line));
    if (secondaryHeaderIndex < 0) {
      throw new Error("Could not find Spirit secondary stat header: AC CM MOVE");
    }

    const rawName = lines.slice(0, primaryHeaderIndex).find(Boolean) || "Spirit";
    const spiritType = this.spiritTypeFromName(rawName);
    const name = this.spiritActorName(rawName, this.force);
    const primaryStats = this.parsePrimaryStats(lines[primaryHeaderIndex], lines[primaryHeaderIndex + 1] ?? "");
    const secondaryStats = this.parseSecondaryStats(lines[secondaryHeaderIndex + 1] ?? "", primaryStats);

    const sectionStartIndex = secondaryHeaderIndex + 2;
    const sections = this.parseSections(lines.slice(sectionStartIndex));

    const initiative = this.parseInitiativeSection(sections.initiative?.text ?? "");
    if (initiative) {
      secondaryStats.initiative = initiative.value;
      secondaryStats.initiativeDice = initiative.dice;
      secondaryStats.initiativeFormula = initiative.raw;
      secondaryStats.initiativeMod = initiative.value - ((primaryStats.attributes.rea?.pool ?? 0) + (primaryStats.attributes.int?.pool ?? 0));
    }

    const astralInitiative = this.parseInitiativeSection(sections.astral_initiative?.text ?? "");
    if (astralInitiative) {
      secondaryStats.astralInitiative = astralInitiative.value;
      secondaryStats.astralInitiativeDice = astralInitiative.dice;
      secondaryStats.astralInitiativeFormula = astralInitiative.raw;
    }

    const parsedSkills = this.parseSkills(sections.skills?.text ?? "");
    const structuredSections = this.structureSections(sections, parsedSkills);

    const defenseRating = structuredSections.defense_rating?.[0] ?? null;
    if (defenseRating?.defenseRating !== undefined) {
      const body = primaryStats.attributes.bod?.pool ?? primaryStats.attributes.bod?.base ?? 0;
      secondaryStats.defenseRating = defenseRating.defenseRating;
      secondaryStats.armor = defenseRating.armor;
      secondaryStats.physicalDefenseMod = defenseRating.defenseRating - body;
    }

    return this.toFoundryActor({
      name,
      rawName,
      spiritType,
      primaryStats,
      secondaryStats,
      parsedSkills,
      sections: structuredSections
    });
  }

  isSecondaryStatHeader(line) {
    const normalized = line.toUpperCase().replace(/\s+/gu, " ").trim();
    return /^AC CM MOVE$/u.test(normalized);
  }

  parsePrimaryStats(headerLine, valuesLine) {
    const headers = headerLine.toUpperCase().replace(/\s+/gu, " ").trim().split(" ");
    const values = this.spiritValueTokens(valuesLine);

    if (headers.length !== values.length) {
      throw new Error(`Spirit primary stat header/value mismatch. Header has ${headers.length} entries, values row has ${values.length}.`);
    }

    const result = {
      rawHeader: headerLine,
      rawValues: valuesLine,
      force: this.force,
      attributes: {}
    };

    for (let i = 0; i < headers.length; i += 1) {
      const id = this.attributeIdForHeader(headers[i]);
      if (!id) continue;
      const evaluated = this.evaluateForceExpression(values[i]);
      result.attributes[id] = {
        base: evaluated,
        pool: evaluated,
        augment: 0,
        formula: values[i]
      };
    }

    if (!result.attributes.mag) result.attributes.mag = { base: this.force, pool: this.force, augment: 0, formula: "F" };
    if (!result.attributes.essence) result.attributes.essence = { base: 6, pool: 6, augment: 0, formula: "6" };

    return result;
  }

  spiritValueTokens(valuesLine) {
    const compact = String(valuesLine ?? "")
      .replace(/[−–—]/gu, "-")
      .replace(/\bF\s*([+\-])\s*(\d+)/giu, "F$1$2")
      .replace(/\s+/gu, " ")
      .trim();
    return compact ? compact.split(" ") : [];
  }

  parseSecondaryStats(valuesLine, primaryStats) {
    const normalized = String(valuesLine ?? "").replace(/\s+/gu, " ").trim();
    const match = normalized.match(/^(?<actions>A\d+\s*,\s*I\d+)\s+(?<cm>.+?)\s+(?<walk>[^\s/]+)\s*\/\s*(?<sprint>[^\s/]+)\s*\/\s*(?<perHit>[+\-−–—]?[^\s]+)(?<moveNote>.*)$/iu);

    if (!match?.groups) {
      throw new Error(`Could not parse Spirit secondary stat row: ${valuesLine}`);
    }

    const rea = primaryStats.attributes.rea?.pool ?? 0;
    const int = primaryStats.attributes.int?.pool ?? 0;
    const body = primaryStats.attributes.bod?.pool ?? 0;
    const initiative = rea + int;

    return {
      raw: valuesLine,
      source: "statblock",
      defenseRating: body,
      initiative,
      initiativeDice: 2,
      actions: match.groups.actions.replace(/\s+/gu, " "),
      conditionMonitor: this.evaluateForceExpression(match.groups.cm, { round: "round" }),
      physicalMonitor: this.evaluateForceExpression(match.groups.cm, { round: "round" }),
      stunMonitor: 0,
      walk: this.evaluateForceExpression(match.groups.walk),
      sprint: this.evaluateForceExpression(match.groups.sprint),
      perHit: this.evaluateForceExpression(match.groups.perHit),
      movementNote: String(match.groups.moveNote ?? "").trim(),
      initiativeMod: 0,
      physicalDefenseMod: 0
    };
  }

  parseInitiativeSection(text) {
    const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
    if (!raw) return null;

    const diceMatch = raw.match(/([+\-]?\d+)\s*D6\b/iu);
    const dice = diceMatch ? Number(diceMatch[1]) : 0;
    const expression = raw
      .replace(/\[[^\]]*\]/u, (value) => value.slice(1, -1))
      .replace(/[+\-]?\s*\d+\s*D6\b/iu, "")
      .replace(/^[+\s]+|[+\s]+$/gu, "")
      .trim();

    return {
      raw,
      value: this.evaluateForceExpression(expression || "0"),
      dice
    };
  }

  parseDefenseRating(text) {
    const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
    if (!raw) return null;

    const armorMatch = raw.match(/\(\s*Armor\s*:\s*([^)]*?)\s*\)/iu);
    const withoutArmor = raw.replace(/\s*\(\s*Armor\s*:[^)]*\)\s*/iu, "").trim();
    const defenseRating = this.evaluateForceExpression(withoutArmor);
    const armor = armorMatch ? this.evaluateForceExpression(armorMatch[1]) : null;

    return {
      raw,
      name: armor === null ? `Defense Rating ${defenseRating}` : `Defense Rating ${defenseRating} (Armor ${armor})`,
      defenseRating,
      armor,
      formula: withoutArmor
    };
  }

  parseSkills(text) {
    const skills = [];
    if (!text) return skills;

    for (const entry of this.smartSplit(text)) {
      const normalized = String(entry ?? "").replace(/\s+/gu, " ").trim();
      if (!normalized) continue;

      const ranked = super.parseSkillEntry(normalized);
      if (ranked) {
        skills.push(ranked);
        continue;
      }

      const id = this.skillIdForName(normalized);
      if (!id) {
        this.warnings.push(`Unknown spirit skill: ${normalized}`);
        continue;
      }

      skills.push({
        raw: normalized,
        id,
        name: normalized,
        points: this.force,
        specialization: "",
        specializationBonus: 0
      });
    }

    return skills;
  }

  skillIdForName(name) {
    const key = String(name ?? "").trim().toLowerCase().replace(/[\s-]+/gu, "_");
    return {
      exotic_ranged_weapon: "exotic_weapons",
      exotic_ranged_weapons: "exotic_weapons"
    }[key] ?? super.skillIdForName(name);
  }

  parseSections(lines = []) {
    const expandedLines = [];

    for (const rawLine of lines) {
      expandedLines.push(...this.splitInlineSpiritSectionLabels(rawLine));
    }

    return super.parseSections(expandedLines);
  }

  splitInlineSpiritSectionLabels(rawLine) {
    const line = this.cleanLine(rawLine);
    if (!line) return [];

    const sectionPattern = /\b(Astral\s+Initiative|Defense\s+Rating|Optional\s+Powers|Initiative|Skills|Powers|Weaknesses|Attacks?)\s*:\s*/giu;
    const matches = Array.from(line.matchAll(sectionPattern));

    if (!matches.length) return [line];

    const parts = [];
    const prefix = line.slice(0, matches[0].index).trim();
    if (prefix) parts.push(prefix);

    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const next = matches[index + 1];
      const label = String(match[1] ?? "").replace(/\s+/gu, " ").trim();
      const text = line.slice(match.index + match[0].length, next?.index ?? line.length).trim();
      parts.push(`${label}: ${text}`.trim());
    }

    return parts;
  }

  normalizeSectionKey(label) {
    const normalized = String(label ?? "").trim().toLowerCase().replace(/\s+/gu, "_");
    return {
      initiative: "initiative",
      astral_initiative: "astral_initiative",
      defense_rating: "defense_rating",
      defense: "defense_rating",
      optional_power: "optional_powers",
      optional_powers: "optional_powers",
      attack: "attacks",
      attacks: "attacks"
    }[normalized] ?? super.normalizeSectionKey(label);
  }

  structureSections(sections, parsedSkills) {
    const structured = {};

    for (const [key, section] of Object.entries(sections)) {
      if (key === "skills") {
        structured.skills = parsedSkills;
      } else if (key === "defense_rating") {
        const parsed = this.parseDefenseRating(section.text);
        structured.defense_rating = parsed ? [parsed] : [{ raw: section.text, name: section.text }];
      } else if (key === "attacks") {
        structured.attacks = this.parseAttackEntries(section.text);
      } else if (key === "initiative" || key === "astral_initiative") {
        structured[key] = [{ raw: section.text, name: section.text }];
      } else if (key === "knowledge_skills" || key === "language_skills") {
        structured[key] = this.smartSplit(section.text).map((raw) => ({ raw, name: raw }));
      } else {
        structured[key] = this.smartSplit(section.text).map((raw) => ({ raw, name: this.extractElementName(raw) }));
      }
    }

    return structured;
  }

  parseAttackEntries(text) {
    const entries = [];
    let buffer = String(text ?? "").replace(/\s+/gu, " ").trim();

    while (buffer.includes("]")) {
      const closeIndex = buffer.indexOf("]");
      const entryText = buffer.slice(0, closeIndex + 1).trim().replace(/,$/u, "");
      if (entryText) entries.push(this.parseWeaponEntry(entryText));
      buffer = buffer.slice(closeIndex + 1).trim().replace(/^,\s*/u, "");
      if (!buffer.includes("[")) break;
    }

    if (buffer) entries.push({ raw: buffer, name: this.extractElementName(buffer), details: [] });
    return entries;
  }

  evaluateForceExpression(value, { round = "nearest" } = {}) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;

    const expression = raw
      .replace(/[−–—]/gu, "-")
      .replace(/[×x]/giu, "*")
      .replace(/\bF\b/giu, String(this.force))
      .replace(/\s+/gu, "")
      .replace(/[^0-9+\-*/().]/gu, "");

    if (!expression) return 0;

    try {
      // The expression is whitelisted to numbers, arithmetic operators and parentheses.
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${expression});`)();
      if (!Number.isFinite(result)) return 0;
      if (round === "floor") return Math.floor(result);
      if (round === "ceil") return Math.ceil(result);
      if (round === "none") return result;
      return Math.round(result);
    } catch (_error) {
      this.warnings.push(`Could not evaluate Force expression: ${raw}`);
      return 0;
    }
  }

  spiritTypeFromName(name) {
    const normalized = String(name ?? "")
      .toLowerCase()
      .replace(/^spirits?\s+of\s+/iu, "")
      .replace(/[^a-z]+/gu, " ")
      .trim();

    return {
      air: "air",
      beast: "beasts",
      beasts: "beasts",
      earth: "earth",
      fire: "fire",
      kin: "kin",
      man: "kin",
      water: "water",
      plant: "plant",
      plants: "plant",
      guardian: "guardian",
      guidance: "guidance",
      task: "task"
    }[normalized] ?? (normalized.replace(/\s+/gu, "_") || "air");
  }

  spiritActorName(rawName, force) {
    const normalized = String(rawName ?? "Spirit")
      .toLowerCase()
      .replace(/^spirits?\s+of\s+/iu, "Spirit of ")
      .replace(/\b\w/gu, (letter) => letter.toUpperCase());
    return `${normalized} (F${force})`;
  }

  toFoundryActor({ name, rawName, spiritType, primaryStats, secondaryStats, parsedSkills, sections }) {
    const img = "systems/shadowrun6-eden/icons/compendium/all-about-drones/savannah-panther.svg";
    const system = this.defaultSpiritSystem();

    this.applyPrimaryStats(system, primaryStats);
    this.applySecondaryStats(system, secondaryStats);
    this.applySkills(system, parsedSkills);

    system.name = name;
    system.rating = this.force;
    system.spiritType = spiritType;
    system.type = "spirit";
    system.editmode = true;

    return {
      name,
      type: "Spirit",
      img,
      system,
      prototypeToken: this.toPrototypeToken({ name, img }),
      items: [],
      effects: [],
      folder: null,
      flags: {
        [SII.MODULE_ID]: {
          documentType: "Actor",
          sourceParser: this.constructor.name,
          rawText: this.originalText,
          spirit: {
            force: this.force,
            spiritType,
            rawName,
            optionalPowerLimit: Math.floor(this.force / 3)
          },
          statBlock: {
            primary: primaryStats,
            secondary: secondaryStats
          },
          sections,
          warnings: this.warnings
        }
      }
    };
  }

  applySecondaryStats(system, secondaryStats) {
    super.applySecondaryStats(system, secondaryStats);

    system.stun.base = 0;
    system.stun.value = 0;
    system.stun.max = 0;
    system.stun.dmg = 0;

    system.initiative.physical.dice = secondaryStats.initiativeDice ?? 2;
    system.initiative.astral.dice = secondaryStats.astralInitiativeDice ?? 3;
    if (secondaryStats.astralInitiative !== undefined) {
      system.initiative.astral.mod = secondaryStats.astralInitiative - (this.force * 2);
    }
  }

  defaultSpiritSystem() {
    const system = this.defaultCritterSystem();
    system.rating = this.force;
    system.spiritType = "air";
    system.type = "spirit";
    system.editmode = true;
    return system;
  }
}
