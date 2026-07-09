import { SII } from "../../constants.js";
import { NpcStatblockParser } from "./npc-statblock-parser.js";

/**
 * Parser for Shadowrun 6 Eden critter stat blocks.
 *
 * Supported shape:
 *   NAME
 *   B A R S W L I C [M] ESS
 *   3 2 3 2 2 2 3 3 [4] 6
 *   I/ID AC CM MOVE
 *   6/1 A1, I2 10 10/20/+3 [(10/20/+2 swimming)]
 *   Defense Rating: 4 (Armor: 1)
 *   Skills: ...
 *   Powers: ...
 *   Weaknesses: ...
 *   Attack: Claws/Bite: DV 2P, Attack Ratings 5/—/—/—/—
 */
export class CritterStatblockParser extends NpcStatblockParser {
  constructor({ text, type = "actor.Critter", folderId = null } = {}) {
    super({ text, type, folderId });
  }

  parse() {
    if (!this.text) {
      ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.missingInput`));
      return null;
    }

    const lines = this.splitLines();
    const primaryHeaderIndex = lines.findIndex((line) => this.isPrimaryAttributeHeader(line));
    if (primaryHeaderIndex <= 0) {
      throw new Error("Could not find Critter primary attribute header: B A R S W L I C [M] ESS");
    }

    const secondaryHeaderIndex = lines.findIndex((line, index) => index > primaryHeaderIndex && this.isSecondaryStatHeader(line));

    const name = lines.slice(0, primaryHeaderIndex).find(Boolean) || "Unnamed Critter";
    const primaryStats = this.parsePrimaryStats(lines[primaryHeaderIndex], lines[primaryHeaderIndex + 1] ?? "");
    const hasSecondaryStats = secondaryHeaderIndex >= 0;
    const secondaryStats = hasSecondaryStats
      ? this.parseSecondaryStats(lines[secondaryHeaderIndex + 1] ?? "", primaryStats)
      : this.defaultSecondaryStats(primaryStats);

    if (!hasSecondaryStats) {
      this.warnings.push("No I/ID/AC/CM/MOVE row found; default derived values were used where possible.");
    }

    const sectionStartIndex = hasSecondaryStats ? secondaryHeaderIndex + 2 : primaryHeaderIndex + 2;
    const sections = this.parseSections(lines.slice(sectionStartIndex));
    const parsedSkills = this.parseSkills(sections.skills?.text ?? "");
    const structuredSections = this.structureSections(sections, parsedSkills);

    const defenseRating = structuredSections.defense_rating?.[0] ?? null;
    if (defenseRating?.defenseRating) {
      const body = primaryStats.attributes.bod?.pool ?? primaryStats.attributes.bod?.base ?? 0;
      secondaryStats.defenseRating = defenseRating.defenseRating;
      secondaryStats.armor = defenseRating.armor;
      secondaryStats.physicalDefenseMod = defenseRating.defenseRating - body;
    }

    return this.toFoundryActor({
      name,
      primaryStats,
      secondaryStats,
      parsedSkills,
      sections: structuredSections
    });
  }

  isSecondaryStatHeader(line) {
    const normalized = line.toUpperCase().replace(/\s+/gu, " ").trim();
    return /^I\/ID AC CM MOVE$/u.test(normalized);
  }

  parseSecondaryStats(valuesLine, primaryStats) {
    const normalized = String(valuesLine ?? "").replace(/\s+/gu, " ").trim();
    const match = normalized.match(/^(?<init>\d+)\s*\/\s*(?<dice>\d+)\s+(?<actions>A\d+\s*,\s*I\d+)\s+(?<cm>\d+)(?:\s*\/\s*\d+)?\s+(?<walk>\d+)\s*\/\s*(?<sprint>\d+)\s*\/\s*(?<perHit>[+-]?\d+)(?<moveNote>.*)$/iu);

    if (!match?.groups) {
      throw new Error(`Could not parse Critter secondary stat row: ${valuesLine}`);
    }

    const rea = primaryStats.attributes.rea?.pool ?? 0;
    const int = primaryStats.attributes.int?.pool ?? 0;
    const body = primaryStats.attributes.bod?.pool ?? 0;
    const initiative = Number(match.groups.init);

    return {
      raw: valuesLine,
      source: "statblock",
      defenseRating: body,
      initiative,
      initiativeDice: Number(match.groups.dice),
      actions: match.groups.actions.replace(/\s+/gu, " "),
      conditionMonitor: Number(match.groups.cm),
      walk: Number(match.groups.walk),
      sprint: Number(match.groups.sprint),
      perHit: Number(match.groups.perHit),
      movementNote: String(match.groups.moveNote ?? "").trim(),
      initiativeMod: initiative - rea - int,
      physicalDefenseMod: 0
    };
  }

  normalizeSectionKey(label) {
    const normalized = String(label ?? "").trim().toLowerCase().replace(/\s+/gu, "_");
    return {
      defense_rating: "defense_rating",
      defense: "defense_rating",
      attack: "attacks",
      attacks: "attacks",
      weakness: "weaknesses",
      weaknesses: "weaknesses"
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
      } else if (key === "weapons") {
        structured.weapons = this.parseWeaponEntries(section.lines);
      } else if (key === "knowledge_skills" || key === "language_skills") {
        structured[key] = this.smartSplit(section.text).map((raw) => ({ raw, name: raw }));
      } else {
        structured[key] = this.smartSplit(section.text).map((raw) => ({ raw, name: this.extractElementName(raw) }));
      }
    }

    return structured;
  }

  parseDefenseRating(text) {
    const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
    if (!raw) return null;

    const match = raw.match(/^(?<defense>\d+)(?:\s*\(\s*Armor\s*:\s*(?<armor>\d+)\s*\))?/iu);
    if (!match?.groups) return { raw, name: raw };

    const defenseRating = Number(match.groups.defense);
    const armor = match.groups.armor === undefined ? null : Number(match.groups.armor);

    return {
      raw,
      name: armor === null ? `Defense Rating ${defenseRating}` : `Defense Rating ${defenseRating} (Armor ${armor})`,
      defenseRating,
      armor
    };
  }

  parseAttackEntries(text) {
    const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
    if (!raw) return [];

    return raw
      .split(/\s*;\s*/u)
      .map((entry) => this.parseAttackEntry(entry))
      .filter(Boolean);
  }

  parseAttackEntry(text) {
    const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
    if (!raw) return null;

    const match = raw.match(/^(?<name>.+?):\s*(?<details>.+)$/u);
    const name = match?.groups?.name?.trim() || this.extractElementName(raw) || raw;
    const detailsText = match?.groups?.details?.trim() || raw;
    const details = this.smartSplit(detailsText).map((part) => part.trim()).filter(Boolean);
    const damage = detailsText.match(/\bDV\s+([^,;]+)/iu)?.[1]?.trim() ?? "";
    const attackRatings = detailsText.match(/\bAttack\s+Ratings?\s+([^,;]+)/iu)?.[1]?.trim() ?? "";

    return {
      raw,
      name,
      details,
      damage,
      attackRatings
    };
  }

  toFoundryActor({ name, primaryStats, secondaryStats, parsedSkills, sections }) {
    const img = "systems/shadowrun6-eden/icons/compendium/cyberweapons/cybersnake.svg";
    const system = this.defaultCritterSystem();

    this.applyPrimaryStats(system, primaryStats);
    this.applySecondaryStats(system, secondaryStats);
    this.applySkills(system, parsedSkills);

    system.name = name;
    system.editmode = true;

    return {
      name,
      type: "Critter",
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

    if (secondaryStats?.physicalDefenseMod !== undefined) {
      system.defenserating = system.defenserating ?? {};
      system.defenserating.physical = system.defenserating.physical ?? { mod: 0 };
      system.defenserating.physical.mod = secondaryStats.physicalDefenseMod;
    }
  }

  defaultCritterSystem() {
    const system = this.defaultNpcSystem();

    delete system.derived;
    delete system.persona;
    delete system.tradition;
    delete system.mortype;
    delete system.matrixIni;
    delete system.rating;
    delete system.gruntmeta;

    system.type = "mundane";
    system.editmode = true;

    return system;
  }
}
