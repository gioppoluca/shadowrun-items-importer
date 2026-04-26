import { SII } from "./constants.js";
import { QualityItemParser } from "./parsers/items/quality-item-parser.js";
import { MetamagicItemParser } from "./parsers/items/metamagic-item-parser.js";
import { GearChemicalsToxinsParser } from "./parsers/items/gear-chemicals-toxins-parser.js";
import { SpellItemParser } from "./parsers/items/spell-item-parser.js";

const PARSER_REGISTRY = {
  quality: QualityItemParser,
  metamagic: MetamagicItemParser,
  spell: SpellItemParser,
  "gear.CHEMICALS.TOXINS": GearChemicalsToxinsParser
};

export class ShadowrunItemsImporterParser {
  parseInput(rawText, folderId, itemType) {
    if (!globalThis.ohm) {
      throw new Error("Ohm.js is required but was not found on globalThis.ohm");
    }

    const ParserClass = PARSER_REGISTRY[itemType];

    if (!ParserClass) {
      const label = CONFIG.Item.typeLabels[itemType]
        ? game.i18n.localize(CONFIG.Item.typeLabels[itemType])
        : itemType;
      ui.notifications?.warn(`${label} is not supported yet.`);
      return null;
    }

    const parser = new ParserClass({ text: rawText, type: itemType, folderId });
    return parser.parse();
  }
}
