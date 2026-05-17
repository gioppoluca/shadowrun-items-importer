import { BaseItemParser } from "./base-item-parser.js";
import { SII } from "../../constants.js";

export class CritterPowerItemParser extends BaseItemParser {
  static ITEM_TYPE = "critterpower";

  parse() {
    if (!this.ensureText()) return null;

    const lines = this.splitCleanLines();
    if (!lines.length) return [];

    const entries = this.parseCritterPowerEntries(lines);
    return entries.map((entry) => this.toFoundryItem(entry));
  }

  parseCritterPowerEntries(lines = []) {
    const entries = [];
    let index = 0;

    while (index < lines.length) {
      const name = this.stripBulletMarker(lines[index]);
      if (!name) {
        index += 1;
        continue;
      }

      const headerIndex = this.findNextHeaderIndex(lines, index + 1);
      if (headerIndex === -1) break;

      // If there are unrelated lines before the next header, the actual name is
      // the line immediately before the header. This keeps the parser robust if
      // a pasted text contains page headings or separators before the item name.
      const itemName = this.stripBulletMarker(lines[headerIndex - 1] ?? name);
      const statLine = lines[headerIndex + 1] ?? "";
      const stats = this.parseStatLine(statLine);

      let descriptionStart = headerIndex + 2;
      let nextItemStart = this.findNextItemStart(lines, descriptionStart);
      if (nextItemStart === -1) nextItemStart = lines.length;

      const descriptionLines = lines
        .slice(descriptionStart, nextItemStart)
        .map((line) => this.stripBulletMarker(line))
        .filter(Boolean);

      entries.push({
        name: itemName || "Unnamed Critter Power",
        stats,
        description: this.linesToHtml(descriptionLines),
        rawStatLine: statLine
      });

      index = nextItemStart;
    }

    return entries;
  }

  findNextHeaderIndex(lines = [], fromIndex = 0) {
    for (let i = fromIndex; i < lines.length; i += 1) {
      if (this.looksLikeCritterPowerHeaderLine(lines[i])) return i;
    }
    return -1;
  }

  findNextItemStart(lines = [], fromIndex = 0) {
    for (let i = fromIndex; i < lines.length - 1; i += 1) {
      if (this.looksLikeCritterPowerHeaderLine(lines[i + 1])) return i;
    }
    return -1;
  }

  looksLikeCritterPowerHeaderLine(line) {
    const normalized = String(line ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");

    return normalized === "TYPE ACTION RANGE DURATION"
      || (normalized.includes("TYPE")
        && normalized.includes("ACTION")
        && normalized.includes("RANGE")
        && normalized.includes("DURATION"));
  }

  parseStatLine(line) {
    const tokens = this.tokenizeStatLine(line);
    if (tokens.length < 4) {
      return {
        type: "physical",
        action: "passive",
        range: "self",
        duration: "instantaneous"
      };
    }

    const [typeToken, actionToken, rangeToken, ...durationTokens] = tokens;
    const durationToken = durationTokens.join(" ");

    return {
      type: this.mapPowerType(typeToken),
      action: this.mapAction(actionToken),
      range: this.mapRange(rangeToken),
      duration: this.mapDuration(durationToken)
    };
  }

  tokenizeStatLine(line) {
    const raw = String(line ?? "").trim();
    if (!raw) return [];

    return raw
      .replace(/\s+/g, " ")
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
  }

  mapPowerType(typeToken) {
    const value = String(typeToken ?? "").trim().toUpperCase();
    if (value === "M" || value === "MANA") return "mana";
    if (value === "P" || value === "PHYSICAL") return "physical";
    return "physical";
  }

  mapAction(actionToken) {
    const value = String(actionToken ?? "").trim().toLowerCase();
    if (value.startsWith("major")) return "major_action";
    if (value.startsWith("minor")) return "minor_action";
    if (value.startsWith("passive")) return "passive";
    if (value.startsWith("free")) return "free";
    return value || "passive";
  }

  mapRange(rangeToken) {
    const value = String(rangeToken ?? "").trim().toUpperCase();
    if (value === "LOS") return "line_of_sight";
    if (value === "LOS(A)" || value === "LOS_AREA" || value === "LOS (A)") return "line_of_sight_area";
    if (value === "SELF") return "self";
    if (value === "TOUCH" || value === "T") return "touch";
    return value ? value.toLowerCase() : "self";
  }

  mapDuration(durationToken) {
    const value = String(durationToken ?? "").trim().toLowerCase();
    if (!value) return "instantaneous";
    if (value.startsWith("instant")) return "instantaneous";
    if (value.startsWith("sustain")) return "sustained";
    if (value.startsWith("permanent")) return "permanent";
    if (value.startsWith("special")) return "special";
    return value.replace(/\s+/gu, "_");
  }

  linesToHtml(lines = []) {
    const text = this.joinWrappedText(lines);
    return text ? `<p>${this.escapeHtml(text)}</p>` : "";
  }

  joinWrappedText(lines = []) {
    return lines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  toFoundryItem(entry) {
    const stats = entry.stats ?? {};

    return {
      name: entry.name || "Unnamed Critter Power",
      type: "critterpower",
      img: "systems/shadowrun6-eden/icons/compendium/default/default-demon.svg",
      system: {
        genesisID: "",
        description: entry.description ?? "",
        product: "",
        page: 0,
        duration: stats.duration || "instantaneous",
        action: stats.action || "passive",
        type: stats.type || "physical",
        range: stats.range || "self"
      },
      effects: [],
      folder: this.folderId ?? null,
      flags: {
        [SII.MODULE_ID]: {
          rawStatLine: entry.rawStatLine || ""
        }
      }
    };
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }
}
