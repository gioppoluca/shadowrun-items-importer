import { SII } from "../../constants.js";

/**
 * Parser for compact Shadowrun 6 Eden NPC stat blocks.
 *
 * Supported shape:
 *   NAME
 *   B A R S W L I C [M] ESS
 *   2 3 4(5) ...
 *   Optional: DR I/ID AC CM MOVE
 *             5 9/1 A1, I2 13 10/15/+1
 *   Skills: ...
 *   Gear: ...
 *   Weapons:
 *   Name [Type, DV ..., Attack Ratings ...]
 */
export class NpcStatblockParser {
  constructor({ text, type = "actor.NPC", folderId = null } = {}) {
    this.originalText = String(text ?? "");
    this.type = String(type ?? "actor.NPC");
    this.folderId = folderId ?? null;
    this.text = this.prepareText(this.originalText);
    this.warnings = [];
  }

  prepareText(text) {
    return String(text ?? "")
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .map((line) => this.cleanLine(line))
      .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
      .join("\n")
      .trim();
  }

  cleanLine(line) {
    return String(line ?? "")
      .replace(/\u00A0/gu, " ")
      .replace(/[ \t]+/gu, " ")
      .trim();
  }

  splitLines() {
    return this.text.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  parse() {
    if (!this.text) {
      ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.missingInput`));
      return null;
    }

    const lines = this.splitLines();
    const primaryHeaderIndex = lines.findIndex((line) => this.isPrimaryAttributeHeader(line));
    if (primaryHeaderIndex <= 0) {
      throw new Error("Could not find NPC primary attribute header: B A R S W L I C [M] ESS");
    }

    const secondaryHeaderIndex = lines.findIndex((line, index) => index > primaryHeaderIndex && this.isSecondaryStatHeader(line));

    const name = lines.slice(0, primaryHeaderIndex).find(Boolean) || "Unnamed NPC";
    const primaryStats = this.parsePrimaryStats(lines[primaryHeaderIndex], lines[primaryHeaderIndex + 1] ?? "");
    const hasSecondaryStats = secondaryHeaderIndex >= 0;
    const secondaryStats = hasSecondaryStats
      ? this.parseSecondaryStats(lines[secondaryHeaderIndex + 1] ?? "", primaryStats)
      : this.defaultSecondaryStats(primaryStats);

    if (!hasSecondaryStats) {
      this.warnings.push("No DR/I/ID/AC/CM/MOVE row found; default derived values were used where possible.");
    }

    const sectionStartIndex = hasSecondaryStats ? secondaryHeaderIndex + 2 : primaryHeaderIndex + 2;
    const sections = this.parseSections(lines.slice(sectionStartIndex));
    const parsedSkills = this.parseSkills(sections.skills?.text ?? "");
    const structuredSections = this.structureSections(sections, parsedSkills);

    return this.toFoundryActor({
      name,
      primaryStats,
      secondaryStats,
      parsedSkills,
      sections: structuredSections
    });
  }

  isPrimaryAttributeHeader(line) {
    const normalized = line.toUpperCase().replace(/\s+/gu, " ").trim();
    return /^B A R S W L I C(?: M)? ESS$/u.test(normalized);
  }

  isSecondaryStatHeader(line) {
    const normalized = line.toUpperCase().replace(/\s+/gu, " ").trim();
    return /^DR I\/ID AC CM MOVE$/u.test(normalized);
  }

  parsePrimaryStats(headerLine, valuesLine) {
    const headers = headerLine.toUpperCase().replace(/\s+/gu, " ").trim().split(" ");
    const values = [...String(valuesLine ?? "").matchAll(/\d+(?:\.\d+)?(?:\(\d+(?:\.\d+)?\))?/gu)].map((match) => match[0]);

    if (headers.length !== values.length) {
      throw new Error(`Primary stat header/value mismatch. Header has ${headers.length} entries, values row has ${values.length}.`);
    }

    const result = {
      rawHeader: headerLine,
      rawValues: valuesLine,
      attributes: {}
    };

    for (let i = 0; i < headers.length; i += 1) {
      const id = this.attributeIdForHeader(headers[i]);
      if (!id) continue;
      result.attributes[id] = this.parseStatValue(values[i]);
    }

    if (!result.attributes.mag) result.attributes.mag = { base: 0, pool: 0, augment: 0 };
    if (!result.attributes.essence) result.attributes.essence = { base: 6, pool: 6, augment: 0 };

    return result;
  }

  attributeIdForHeader(header) {
    return {
      B: "bod",
      A: "agi",
      R: "rea",
      S: "str",
      W: "wil",
      L: "log",
      I: "int",
      C: "cha",
      M: "mag",
      ESS: "essence"
    }[header] ?? null;
  }

  parseStatValue(value) {
    const match = String(value ?? "").match(/^(\d+(?:\.\d+)?)(?:\((\d+(?:\.\d+)?)\))?$/u);
    if (!match) return { base: 0, pool: 0, augment: 0 };

    const base = Number(match[1]);
    const pool = match[2] === undefined ? base : Number(match[2]);
    return {
      base,
      pool,
      augment: Number((pool - base).toFixed(2))
    };
  }

  parseSecondaryStats(valuesLine, primaryStats) {
    const normalized = String(valuesLine ?? "").replace(/\s+/gu, " ").trim();
    const match = normalized.match(/^(?<dr>\d+)(?:\((?<drAlt>\d+)\))?\s+(?<init>\d+)\s*\/\s*(?<dice>\d+)\s+(?<actions>A\d+\s*,\s*I\d+)\s+(?<cm>\d+)(?:\s*\/\s*\d+)?\s+(?<walk>\d+)\s*\/\s*(?<sprint>\d+)\s*\/\s*(?<perHit>[+-]?\d+)$/iu);

    if (!match?.groups) {
      throw new Error(`Could not parse NPC secondary stat row: ${valuesLine}`);
    }

    const rea = primaryStats.attributes.rea?.pool ?? 0;
    const int = primaryStats.attributes.int?.pool ?? 0;
    const body = primaryStats.attributes.bod?.pool ?? 0;

    return {
      raw: valuesLine,
      source: "statblock",
      defenseRating: Number(match.groups.drAlt ?? match.groups.dr),
      initiative: Number(match.groups.init),
      initiativeDice: Number(match.groups.dice),
      actions: match.groups.actions.replace(/\s+/gu, " "),
      conditionMonitor: Number(match.groups.cm),
      walk: Number(match.groups.walk),
      sprint: Number(match.groups.sprint),
      perHit: Number(match.groups.perHit),
      initiativeMod: Number(match.groups.init) - rea - int,
      physicalDefenseMod: Number(match.groups.drAlt ?? match.groups.dr) - body
    };
  }

  defaultSecondaryStats(primaryStats) {
    const body = primaryStats.attributes.bod?.pool ?? primaryStats.attributes.bod?.base ?? 2;
    const willpower = primaryStats.attributes.wil?.pool ?? primaryStats.attributes.wil?.base ?? 2;
    const rea = primaryStats.attributes.rea?.pool ?? 0;
    const int = primaryStats.attributes.int?.pool ?? 0;
    const physicalMonitor = Math.ceil(body / 2) + 8;
    const stunMonitor = Math.ceil(willpower / 2) + 8;

    return {
      raw: "",
      source: "derived",
      defenseRating: body,
      initiative: rea + int,
      initiativeDice: 1,
      actions: "",
      conditionMonitor: physicalMonitor,
      physicalMonitor,
      stunMonitor,
      walk: null,
      sprint: null,
      perHit: null,
      initiativeMod: 0,
      physicalDefenseMod: 0
    };
  }

  parseSections(lines = []) {
    const sections = {};
    let current = null;

    for (const rawLine of lines) {
      const line = this.cleanLine(rawLine);
      if (!line) continue;

      const match = line.match(/^([A-Za-z][A-Za-z\s/&-]{0,40}):\s*(.*)$/u);
      if (match) {
        const key = this.normalizeSectionKey(match[1]);
        current = {
          label: match[1].trim(),
          lines: []
        };
        sections[key] = current;
        if (match[2]?.trim()) current.lines.push(match[2].trim());
        continue;
      }

      if (current) current.lines.push(line);
    }

    for (const section of Object.values(sections)) {
      section.text = section.lines.join(" ").replace(/\s+/gu, " ").trim();
    }

    return sections;
  }

  normalizeSectionKey(label) {
    const normalized = String(label ?? "").trim().toLowerCase().replace(/\s+/gu, "_");
    return {
      skill: "skills",
      skills: "skills",
      knowledge_skill: "knowledge_skills",
      knowledge_skills: "knowledge_skills",
      language_skill: "language_skills",
      language_skills: "language_skills",
      gear: "gear",
      equipment: "gear",
      weapons: "weapons",
      weapon: "weapons",
      spells: "spells",
      spell: "spells",
      augmentations: "augmentations",
      augmentation: "augmentations",
      cyberware: "augmentations",
      bodytech: "augmentations",
      programs: "programs",
      qualities: "qualities",
      powers: "powers",
      adept_powers: "adept_powers",
      vehicles: "vehicles"
    }[normalized] ?? normalized;
  }

  parseSkills(text) {
    const skills = [];
    if (!text) return skills;

    for (const entry of this.smartSplit(text)) {
      const parsed = this.parseSkillEntry(entry);
      if (parsed) skills.push(parsed);
      else this.warnings.push(`Could not parse skill entry: ${entry}`);
    }

    return skills;
  }

  parseSkillEntry(entry) {
    const normalized = String(entry ?? "").replace(/\s+/gu, " ").trim();
    if (!normalized) return null;

    const match = normalized.match(/^(.+?)\s+(\d+)(?:\s*\((.+?)\s*\+\s*(\d+)\))?$/u);
    if (!match) return null;

    const name = match[1].trim();
    const id = this.skillIdForName(name);
    if (!id) {
      this.warnings.push(`Unknown skill: ${name}`);
      return null;
    }

    return {
      raw: normalized,
      id,
      name,
      points: Number(match[2]),
      specialization: match[3]?.trim() ?? "",
      specializationBonus: match[4] ? Number(match[4]) : 0
    };
  }

  skillIdForName(name) {
    const key = String(name ?? "").trim().toLowerCase().replace(/[\s-]+/gu, "_");
    return {
      astral: "astral",
      athletics: "athletics",
      biotech: "biotech",
      close_combat: "close_combat",
      con: "con",
      conjuring: "conjuring",
      cracking: "cracking",
      electronics: "electronics",
      enchanting: "enchanting",
      engineering: "engineering",
      exotic_weapons: "exotic_weapons",
      firearms: "firearms",
      influence: "influence",
      outdoors: "outdoors",
      perception: "perception",
      piloting: "piloting",
      sorcery: "sorcery",
      stealth: "stealth",
      tasking: "tasking"
    }[key] ?? null;
  }

  structureSections(sections, parsedSkills) {
    const structured = {};

    for (const [key, section] of Object.entries(sections)) {
      if (key === "skills") {
        structured.skills = parsedSkills;
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

  parseWeaponEntries(lines = []) {
    const entries = [];
    let buffer = "";

    const flushCompleteEntries = () => {
      let safety = 0;
      while (buffer.includes("]") && safety < 100) {
        safety += 1;
        const closeIndex = buffer.indexOf("]");
        const entryText = buffer.slice(0, closeIndex + 1).trim().replace(/,$/u, "");
        if (entryText) entries.push(this.parseWeaponEntry(entryText));
        buffer = buffer.slice(closeIndex + 1).trim().replace(/^,\s*/u, "");
        if (!buffer.includes("[") || !buffer.includes("]")) break;
      }
    };

    for (const line of lines) {
      buffer = `${buffer} ${line}`.replace(/\s+/gu, " ").trim();
      flushCompleteEntries();
    }

    if (buffer) entries.push({ raw: buffer, name: this.extractElementName(buffer), details: [] });
    return entries;
  }

  parseWeaponEntry(text) {
    const match = String(text ?? "").match(/^(.+?)\s*\[(.*)\]$/u);
    if (!match) return { raw: text, name: this.extractElementName(text), details: [] };

    return {
      raw: text,
      name: match[1].trim(),
      details: this.smartSplit(match[2]).map((part) => part.trim()).filter(Boolean)
    };
  }

  smartSplit(text) {
    const result = [];
    let current = "";
    let parenDepth = 0;
    let bracketDepth = 0;

    for (const char of String(text ?? "")) {
      if (char === "(") parenDepth += 1;
      if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
      if (char === "[") bracketDepth += 1;
      if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

      if (char === "," && parenDepth === 0 && bracketDepth === 0) {
        const value = current.trim();
        if (value) result.push(value);
        current = "";
        continue;
      }

      current += char;
    }

    const value = current.trim();
    if (value) result.push(value);
    return result;
  }

  extractElementName(raw) {
    return String(raw ?? "")
      .replace(/^\d+\s*x\s+/iu, "")
      .replace(/\s*\[[\s\S]*$/u, "")
      .replace(/\s*\([\s\S]*$/u, "")
      .trim();
  }

  toFoundryActor({ name, primaryStats, secondaryStats, parsedSkills, sections }) {
    const img = "systems/shadowrun6-eden/icons/compendium/status/human_shield.svg";
    const system = this.defaultNpcSystem();

    this.applyPrimaryStats(system, primaryStats);
    this.applySecondaryStats(system, secondaryStats);
    this.applySkills(system, parsedSkills);

    system.name = name;
    system.mortype = this.inferMortype(primaryStats, sections);
    system.editmode = true;

    return {
      name,
      type: "NPC",
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

  applyPrimaryStats(system, primaryStats) {
    for (const [id, value] of Object.entries(primaryStats.attributes)) {
      if (id === "essence") {
        // Do not apply the printed NPC Essence value to the actor sheet.
        // The Shadowrun 6 Eden sheet calculates Essence reduction from embedded
        // augmentations, so imported actors must start from the natural value.
        system.attributes.essence.base = 6;
        system.attributes.essence.pool = 6;
        system.attributes.essence.mod = 0;
        continue;
      }

      if (!system.attributes[id]) continue;
      system.attributes[id].base = value.base;
      system.attributes[id].pool = value.pool;
      if (Object.prototype.hasOwnProperty.call(system.attributes[id], "augment")) {
        system.attributes[id].augment = value.augment;
      }
    }
  }

  applySecondaryStats(system, secondaryStats) {
    const physicalMonitor = secondaryStats.physicalMonitor ?? secondaryStats.conditionMonitor ?? 9;
    const stunMonitor = secondaryStats.stunMonitor ?? secondaryStats.conditionMonitor ?? physicalMonitor;

    system.physical.base = physicalMonitor;
    system.physical.value = physicalMonitor;
    system.physical.max = physicalMonitor * 2;

    system.stun.base = stunMonitor;
    system.stun.value = stunMonitor;
    system.stun.max = stunMonitor * 2;

    system.defenserating.physical.mod = secondaryStats.physicalDefenseMod ?? 0;
    system.initiative.physical.mod = secondaryStats.initiativeMod ?? 0;
    system.initiative.physical.dice = secondaryStats.initiativeDice ?? 1;
    system.initiative.actions = secondaryStats.actions ? (secondaryStats.initiativeDice ?? 1) + 1 : 0;

    if (Number.isFinite(secondaryStats.walk)) system.walk = secondaryStats.walk;
    if (Number.isFinite(secondaryStats.sprint)) system.sprint = secondaryStats.sprint;
    if (Number.isFinite(secondaryStats.perHit)) system.perHit = secondaryStats.perHit;
  }

  applySkills(system, parsedSkills = []) {
    for (const skill of parsedSkills) {
      if (!system.skills[skill.id]) continue;
      system.skills[skill.id].points = skill.points;
      system.skills[skill.id].specialization = skill.specialization;
    }
  }

  inferMortype(primaryStats, sections) {
    const hasMagic = (primaryStats.attributes.mag?.pool ?? 0) > 0;
    const hasSpells = Array.isArray(sections.spells) && sections.spells.length > 0;
    const hasAdeptPowers = Array.isArray(sections.adept_powers) && sections.adept_powers.length > 0;

    if (hasMagic && hasSpells && hasAdeptPowers) return "mysticadept";
    if (hasMagic && hasAdeptPowers) return "adept";
    if (hasMagic) return "magician";
    return "mundane";
  }

  defaultNpcSystem() {
    return {
      attributes: {
        bod: this.defaultAttribute(2),
        agi: this.defaultAttribute(2),
        rea: this.defaultAttribute(2),
        str: this.defaultAttribute(2),
        wil: this.defaultAttribute(2),
        log: this.defaultAttribute(2),
        int: this.defaultAttribute(2),
        cha: this.defaultAttribute(1),
        mag: { base: 0, mod: 0, pool: 0, min: 0 },
        res: { base: 0, mod: 0, pool: 0 },
        edg: { current: 0, max: 1 },
        essence: { base: 6, mod: 0, pool: 6 }
      },
      metatype: "human",
      type: "npc",
      gender: "",
      physical: { base: 9, mod: 0, modString: "", value: 9, dmg: 0, max: 18 },
      stun: { base: 9, mod: 0, modString: "", value: 9, dmg: 0, max: 18 },
      overflow: { mod: 0, modString: "", value: 0, dmg: 0, max: 32 },
      edge: { value: 0, max: 1 },
      derived: {
        composure: { mod: 0 },
        judge_intentions: { mod: 0 },
        memory: { mod: 0 },
        lift_carry: { mod: 0 },
        matrix_perception: { mod: 0 }
      },
      defenserating: {
        physical: { mod: 0 },
        matrix: { mod: 0 },
        vehicle: { mod: 0 },
        astral: { mod: 0 },
        social: { mod: 0 }
      },
      defensepool: {
        physical: { mod: 0 },
        astral: { mod: 0 },
        spells_direct: { mod: 0 },
        spells_indirect: { mod: 0 },
        spells_other: { mod: 0 },
        vehicle: { mod: 0 },
        toxin: { mod: 0 },
        damage_physical: { mod: 0 },
        damage_astral: { mod: 0 }
      },
      initiative: {
        astral: { mod: 0, dice: 2, diceMod: 0 },
        matrix: { mod: 0, dice: 1, diceMod: 0 },
        physical: { mod: 0, dice: 1, diceMod: 0 },
        actions: 0
      },
      walk: 5,
      sprint: 10,
      perHit: 1,
      skills: this.defaultSkills(),
      tradition: { genesisID: "", name: "", attribute: "log" },
      persona: {
        device: { mod: { a: 0, s: 0, d: 0, f: 0 } },
        living: { mod: { a: 0, s: 0, d: 0, f: 0 } },
        used: { a: 0, s: 0, d: 0, f: 0 }
      },
      name: "",
      mortype: "mundane",
      matrixIni: "vrcold",
      rating: 1,
      gruntmeta: "",
      editmode: true
    };
  }

  defaultAttribute(value) {
    return { base: value, mod: 0, modString: "", augment: 0, pool: value };
  }

  defaultSkill() {
    return {
      points: 0,
      specialization: "",
      expertise: "",
      modifier: 0,
      augment: 0,
      expandedSpecializations: []
    };
  }

  defaultSkills() {
    return [
      "astral",
      "athletics",
      "biotech",
      "close_combat",
      "con",
      "conjuring",
      "cracking",
      "electronics",
      "enchanting",
      "engineering",
      "exotic_weapons",
      "firearms",
      "influence",
      "outdoors",
      "perception",
      "piloting",
      "sorcery",
      "stealth",
      "tasking"
    ].reduce((skills, id) => {
      skills[id] = this.defaultSkill();
      return skills;
    }, {});
  }

  toPrototypeToken({ name, img }) {
    return {
      name,
      displayName: 20,
      actorLink: false,
      width: 1,
      height: 1,
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
      disposition: -1,
      displayBars: 0,
      bar1: { attribute: "physical" },
      bar2: { attribute: "stun" },
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
        animation: { type: null, speed: 5, intensity: 5, reverse: false },
        darkness: { min: 0, max: 1 }
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
      occludable: { radius: 0 },
      ring: {
        enabled: false,
        colors: { ring: null, background: null },
        effects: 1,
        subject: { scale: 1, texture: null }
      },
      turnMarker: { mode: 1, animation: null, src: null, disposition: false },
      movementAction: null,
      flags: {},
      randomImg: false,
      appendNumber: false,
      prependAdjective: true
    };
  }
}
