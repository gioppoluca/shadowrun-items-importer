import { SII } from "./constants.js";
import { ShadowrunItemsImporterUtils as Utils } from "./utils.js";
import { ShadowrunItemsImporterParser } from "./parser.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ShadowrunItemsImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static APP_INSTANCE = null;

  static DEFAULT_OPTIONS = {
    id: SII.APP_ID,
    tag: "section",
    classes: [SII.MODULE_ID, "window-app"],
    position: {
      width: 860,
      height: 680
    },
    window: {
      title: `${SII.MODULE_ID}.title`,
      resizable: true,
      icon: "fa-solid fa-file-import"
    },
    actions: {
      importItems: ShadowrunItemsImporterApp.onImportAction
    }
  };

  static PARTS = {
    content: {
      template: SII.TEMPLATES.WINDOW
    }
  };

  static async show(options = {}) {
    if (!this.APP_INSTANCE) this.APP_INSTANCE = new this(options);
    await this.APP_INSTANCE.render({ force: true });
    return this.APP_INSTANCE;
  }

  async _prepareContext(_options) {
    const itemTypes = Utils.getItemTypeOptions();
    const folders = Utils.getItemFolders();
    const rememberFolder = game.settings.get(SII.MODULE_ID, SII.SETTINGS.REMEMBER_FOLDER);
    const lastFolderId = rememberFolder ? game.settings.get(SII.MODULE_ID, SII.SETTINGS.LAST_FOLDER) : "";
    const lastType = game.settings.get(SII.MODULE_ID, SII.SETTINGS.LAST_TYPE) || itemTypes[0]?.value || "";

    const selectedItemType = lastType;
    const gearTypeOptions = Utils.getGearTypeOptions();
    const selectedGearType = gearTypeOptions[0]?.value || "";
    const gearSubtypeOptions = selectedItemType === "gear" ? Utils.getGearSubtypeOptions(selectedGearType) : [];
    const selectedGearSubtype = gearSubtypeOptions[0]?.value || "";

    return {
      moduleId: SII.MODULE_ID,
      title: game.i18n.localize(`${SII.MODULE_ID}.title`),
      folders: [
        {
          id: "",
          name: game.i18n.localize(`${SII.MODULE_ID}.label.none`),
          selected: !lastFolderId
        },
        ...folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          selected: folder.id === lastFolderId
        }))
      ],
      itemTypes: itemTypes.map((type) => ({
        value: type.value,
        label: type.label,
        selected: type.value === lastType
      })),
      isGearSelected: selectedItemType === "gear",
      gearTypes: gearTypeOptions.map((type) => ({
        value: type.value,
        label: type.label,
        selected: type.value === selectedGearType
      })),
      gearSubtypes: gearSubtypeOptions.map((type) => ({
        value: type.value,
        label: type.label,
        selected: type.value === selectedGearSubtype
      }))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    const textarea = root.querySelector("textarea[name='input']");
    if (textarea && !textarea.value && game.settings.get(SII.MODULE_ID, SII.SETTINGS.DEBUG)) {
      textarea.value = `Ares Predator VI\nHeavy Pistol\n\nDamage Value 3P\nAttack Rating 10/10/8/6\nMode SA\nAmmo 15(c)\nAvailability 3\nCost 500¥`;
    }

    const itemTypeSelect = root.querySelector("select[name='itemType']");
    const gearTypeSelect = root.querySelector("select[name='gearType']");
    const gearSubtypeSelect = root.querySelector("select[name='gearSubtype']");
    const gearFields = root.querySelector(".sii-gear-fields");

    const refreshGearFields = () => {
      const itemType = itemTypeSelect?.value ?? "";
      const gearType = gearTypeSelect?.value ?? "";

      if (gearFields) {
        gearFields.style.display = itemType === "gear" ? "" : "none";
      }

      if (!gearSubtypeSelect) return;

      gearSubtypeSelect.innerHTML = "";

      if (itemType !== "gear" || !gearType) return;

      const subtypeOptions = Utils.getGearSubtypeOptions(gearType);
      for (const option of subtypeOptions) {
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label;
        gearSubtypeSelect.appendChild(el);
      }
    };

    itemTypeSelect?.addEventListener("change", refreshGearFields);
    gearTypeSelect?.addEventListener("change", refreshGearFields);

    refreshGearFields();
  }

  static async onImportAction(_event, _target) {
    const app = this.APP_INSTANCE;
    const root = this.element;
    console.log("Import Action Triggered", { event: _event, target: _target, theroot: root, theapp: app, thethis: this });
    if (!root) return;
    try {

      const input = root.querySelector("textarea[name='input']")?.value ?? "";
      const folderId = root.querySelector("select[name='folderId']")?.value ?? "";
      const baseType = root.querySelector("select[name='itemType']")?.value ?? "";
      const gearType = root.querySelector("select[name='gearType']")?.value ?? "";
      const gearSubtype = root.querySelector("select[name='gearSubtype']")?.value ?? "";

      if (!input.trim()) {
        ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.missingInput`));
        return;
      }

      let type = baseType;
      if (baseType === "gear") {
        type = `gear.${gearType}.${gearSubtype}`;
      }

      if (game.settings.get(SII.MODULE_ID, SII.SETTINGS.REMEMBER_FOLDER)) {
        await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_FOLDER, folderId);
      }
      await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_TYPE, type);

      let parser = new ShadowrunItemsImporterParser();
      console.log("Parser Instance Created", { parser });
      console.log(input, folderId, type);
      let parsedObject = await parser.parseInput(input, folderId || null, type);
      console.log("Parsed Object:", parsedObject);
      if (!parsedObject) return;

      const created = await this.createItemDocument(parsedObject, folderId);

      ui.notifications?.info(`Created item: ${created.name}`);
      await created.sheet.render(true);
      this.close();
    } catch (error) {
      console.error("Shadowrun importer failed", error);
      ui.notifications?.error(`Import failed: ${error.message}`);

    }
  }


  async ensureFolder(folderName) {
    const cleanName = String(folderName ?? "").trim();
    if (!cleanName) return null;

    let folder = game.folders?.find(
      (f) => f.type === "Item" && f.name === cleanName
    );

    if (!folder) {
      folder = await Folder.create({
        name: cleanName,
        type: "Item",
        color: "#6f8f9f"
      });
    }

    return folder;
  }

  async createItemDocument(itemData, folderName) {
    const folder = await this.ensureFolder(folderName);

    const payload = foundry.utils.deepClone(itemData);
    payload.folder = folder?.id ?? null;

    return await Item.create(payload);
  }
}
