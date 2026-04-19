import { SII } from "./constants.js";
import { ShadowrunItemsImporterUtils as Utils } from "./utils.js";
import { GenericShadowrunItemParser } from "./parsers/items/generic-item-parser.js";
import { QualityItemParser } from "./parsers/items/quality-item-parser.js";

export class ShadowrunItemsImporterParser {
  static ensureOhm() {
    const Ohm = Utils.getOhm();
    if (!Ohm) {
      ui.notifications?.error(game.i18n.localize(`${SII.MODULE_ID}.notifications.ohmMissing`));
      return null;
    }
    return Ohm;
  }

  static createItemParser({ text, type, folderId, Ohm }) {
    switch (type) {
      default:
        return new GenericShadowrunItemParser({ text, type, folderId, Ohm });
    }
  }

  parseInput(rawText, folderId, itemType) {
    if (!globalThis.ohm) {
      throw new Error("Ohm.js is required but was not found on globalThis.ohm");
    }

    let parser;
    console.log("Creating parser for type:", itemType, folderId, rawText);

    switch (itemType) {
      case "quality":
        parser = new QualityItemParser({ text: rawText, type: itemType, folderId });
        break;

      default:
        ui.notifications?.warn(`${game.i18n.localize(CONFIG.Item.typeLabels[itemType])} is not supported yet.`);
        return null;
    }

    return parser.parse();
  }
}


