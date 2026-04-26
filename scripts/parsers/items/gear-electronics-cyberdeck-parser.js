import { GearElectronicsDeviceTableParser } from "./gear-electronics-device-table-parser.js";

export class GearElectronicsCyberdeckParser extends GearElectronicsDeviceTableParser {
  constructor({ text, type, folderId }) {
    super({
      text,
      type,
      folderId,
      gearSubtype: "CYBERDECK",
      attributeKeys: ["a", "s"],
      expectedAttributeLabel: "A/S"
    });
  }
}
