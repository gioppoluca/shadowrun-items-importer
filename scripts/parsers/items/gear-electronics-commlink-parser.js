import { GearElectronicsDeviceTableParser } from "./gear-electronics-device-table-parser.js";

export class GearElectronicsCommlinkParser extends GearElectronicsDeviceTableParser {
  constructor({ text, type, folderId }) {
    super({
      text,
      type,
      folderId,
      gearSubtype: "COMMLINK",
      attributeKeys: ["d", "f"],
      expectedAttributeLabel: "D/F"
    });
  }
}
