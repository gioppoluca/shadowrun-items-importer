import { SII } from "../../constants.js";
import { ShadowrunItemsImporterUtils as Utils } from "../../utils.js";

export class BaseItemParser {
  constructor({ text, type, folderId }) {
    if (new.target === BaseItemParser) {
      throw new Error("BaseItemParser is abstract and cannot be instantiated directly.");
    }

    this.originalText = String(text ?? "");
    this.type = String(type ?? "");
    this.folderId = folderId ?? null;
    this.Ohm = Utils.getOhm();
    this.text = this.prepareText(this.originalText);
  }

  prepareText(text) {
    return this.normalizeLineEndings(text)
      .split("\n")
      .map((line) => this.cleanLine(line))
      .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
      .join("\n")
      .trim();
  }

  normalizeLineEndings(text) {
    return String(text ?? "").replace(/\r\n?/g, "\n");
  }

  cleanLine(line) {
    return String(line ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  splitLines(text = this.text) {
    return String(text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Same as splitLines, but keeps order and removes empty lines after normalization.
   */
  splitCleanLines(text = this.text) {
    return this.splitLines(text);
  }

  /**
   * Removes a leading bullet marker if present.
   * Examples:
   *  - "• Cost: 4 Karma" -> "Cost: 4 Karma"
   *  - "- Cost: 4 Karma" -> "Cost: 4 Karma"
   *  - "* Cost: 4 Karma" -> "Cost: 4 Karma"
   */
  stripBulletMarker(line) {
    return String(line ?? "").replace(/^[•*\-]\s*/u, "").trim();
  }

  /**
   * Returns true if the line looks like a labeled field after an optional bullet.
   * Examples:
   *  - "• Cost: 4 Karma"
   *  - "Cost: 4 Karma"
   *  - "Game Effect: ..."
   */
  isBulletLikeField(line) {
    const normalized = this.stripBulletMarker(line);
    return /^[^:]{1,80}:\s*\S+/u.test(normalized);
  }

  /**
   * Lazily builds a tiny Ohm grammar for "Label: Value" lines.
   * This is intentionally generic so subclasses can reuse it.
   */
  getFieldLineGrammar() {
    if (!this.Ohm) {
      throw new Error("Ohm.js is not available");
    }

    if (!this._fieldLineGrammar) {
      this._fieldLineGrammar = this.Ohm.grammar(String.raw`
ShadowrunFieldLine {
  fieldLine = label ":" ws* value
  label     = (~":" any)+
  value     = any*
  ws        = " " | "\t"
}
`);
    }

    return this._fieldLineGrammar;
  }

  /**
   * Parses a single "Label: Value" line, with or without a leading bullet marker.
   * Returns null if it does not match.
   */
  parseFieldLine(line) {
    const normalized = this.stripBulletMarker(line);
    const grammar = this.getFieldLineGrammar();
    const match = grammar.match(normalized, "fieldLine");

    if (match.failed()) return null;

    const semantics = grammar.createSemantics();
    semantics.addOperation("toObject", {
      fieldLine(label, _colon, _ws, value) {
        return {
          label: label.sourceString.trim(),
          value: value.sourceString.trim(),
        };
      },

      _terminal() {
        return this.sourceString;
      }
    });

    return semantics(match).toObject();
  }

  /**
   * Extracts the first signed/unsigned integer found in text.
   * Returns fallback if none is found.
   */
  extractFirstInteger(text, fallback = 0) {
    const match = String(text ?? "").match(/-?\d+/);
    return match ? Number(match[0]) : fallback;
  }

  /**
   * Normalizes labels for dictionary keys:
   * "Game Effect" -> "game effect"
   */
  normalizeLabel(label) {
    return String(label ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  buildResult(extra = {}) {
    return {
      ok: true,
      bootstrap: true,
      parserClass: this.constructor.name,
      type: this.type,
      folderId: this.folderId,
      text: this.text,
      ...extra
    };
  }

  ensureText() {
    if (!this.text) {
      ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.missingInput`));
      return false;
    }
    return true;
  }

  log(...args) {
    Utils.log(this.constructor.name, ...args);
  }

  parse() {
    throw new Error(`${this.constructor.name} must implement parse().`);
  }
}