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

    const savedType = game.settings.get(SII.MODULE_ID, SII.SETTINGS.LAST_TYPE) || itemTypes[0]?.value || "";
    const legacyGearParts = savedType.startsWith("gear.") ? savedType.split(".") : [];
    const selectedItemType = legacyGearParts.length ? "gear" : savedType;

    const gearTypeOptions = Utils.getGearTypeOptions();
    const selectedGearType = game.settings.get(SII.MODULE_ID, SII.SETTINGS.LAST_GEAR_TYPE)
      || legacyGearParts[1]
      || gearTypeOptions[0]?.value
      || "";

    const gearSubtypeOptions = selectedItemType === "gear" ? Utils.getGearSubtypeOptions(selectedGearType) : [];
    const selectedGearSubtype = game.settings.get(SII.MODULE_ID, SII.SETTINGS.LAST_GEAR_SUBTYPE)
      || legacyGearParts[2]
      || gearSubtypeOptions[0]?.value
      || "";

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
        selected: type.value === selectedItemType
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
      textarea.value = `Narcoject\n• Vector: Injection\n• Speed: Immediate\n• Duration: (6 – Body) hours, minimum 1 hour\n• Power: 15\n• Effect: Stun Damage\nA common tranquilizer, narcoject is typically\nused with dart guns. It has no side effects.`;
    }

    const itemTypeSelect = root.querySelector("select[name='itemType']");
    const gearTypeSelect = root.querySelector("select[name='gearType']");
    const gearSubtypeSelect = root.querySelector("select[name='gearSubtype']");
    const gearFields = root.querySelector(".sii-gear-fields");

    const refreshGearFields = () => {
      const itemType = itemTypeSelect?.value ?? "";
      const gearType = gearTypeSelect?.value ?? "";
      const previousSubtype = gearSubtypeSelect?.value ?? "";

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
        el.selected = option.value === previousSubtype;
        gearSubtypeSelect.appendChild(el);
      }
    };

    itemTypeSelect?.addEventListener("change", refreshGearFields);
    gearTypeSelect?.addEventListener("change", refreshGearFields);

    refreshGearFields();
  }

  static async onImportAction(_event, _target) {
    const app = ShadowrunItemsImporterApp.APP_INSTANCE;
    const root = app?.element;
    if (!app || !root) return;

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

      const parserType = baseType === "gear" ? `gear.${gearType}.${gearSubtype}` : baseType;

      if (game.settings.get(SII.MODULE_ID, SII.SETTINGS.REMEMBER_FOLDER)) {
        await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_FOLDER, folderId);
      }

      await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_TYPE, baseType);
      if (baseType === "gear") {
        await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_GEAR_TYPE, gearType);
        await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_GEAR_SUBTYPE, gearSubtype);
      }

      const parser = new ShadowrunItemsImporterParser();
      const parsedObject = await parser.parseInput(input, folderId || null, parserType);
      if (!parsedObject) return;

      const parsedObjects = Array.isArray(parsedObject) ? parsedObject : [parsedObject];
      const createdDocuments = [];

      for (const documentData of parsedObjects) {
        const created = await app.createImportedDocument(documentData, folderId || null);
        createdDocuments.push(created);

        const warnings = documentData.flags?.[SII.MODULE_ID]?.warnings ?? [];
        for (const warning of warnings) {
          ui.notifications?.warn(warning);
        }
      }

      if (createdDocuments.length === 1) {
        const label = app.labelForCreatedDocument(createdDocuments[0]);
        ui.notifications?.info(`Created ${label}: ${createdDocuments[0].name}`);
        await createdDocuments[0].sheet.render(true);
      } else {
        ui.notifications?.info(app.creationSummary(createdDocuments));
      }

      app.close();
    } catch (error) {
      console.error("Shadowrun importer failed", error);
      ui.notifications?.error(`Import failed: ${error.message}`);
    }
  }

  async createImportedDocument(documentData, itemFolderId) {
    const documentType = this.resolveDocumentType(documentData);

    if (documentType === "Actor") {
      return this.createActorDocument(documentData, this.resolveActorFolderId(documentData));
    }

    return this.createItemDocument(documentData, itemFolderId);
  }

  resolveDocumentType(documentData) {
    const explicitType = documentData?.flags?.[SII.MODULE_ID]?.documentType;
    if (explicitType === "Actor" || explicitType === "Item") return explicitType;

    if (documentData?.type && CONFIG.Actor?.typeLabels?.[documentData.type] && !CONFIG.Item?.typeLabels?.[documentData.type]) {
      return "Actor";
    }

    return "Item";
  }

  resolveActorFolderId(_actorData) {
    // Vehicles are intentionally created at actor-root level for now.
    // Keeping this as a method makes it easy to route them to Actor folders later.
    return null;
  }

  async createItemDocument(itemData, folderId) {
    const payload = foundry.utils.deepClone(itemData);
    const normalizedFolderId = folderId || null;
    payload.folder = normalizedFolderId;

    const created = await Item.create(payload);

    if (normalizedFolderId && created.folder?.id !== normalizedFolderId) {
      await created.update({ folder: normalizedFolderId });
    }

    return created;
  }

  async createActorDocument(actorData, actorFolderId = null) {
    const payload = foundry.utils.deepClone(actorData);
    const normalizedFolderId = actorFolderId || null;
    payload.folder = normalizedFolderId;

    const created = await Actor.create(payload);

    if (normalizedFolderId && created.folder?.id !== normalizedFolderId) {
      await created.update({ folder: normalizedFolderId });
    }

    return created;
  }

  labelForCreatedDocument(document) {
    const documentName = document?.documentName || document?.constructor?.documentName || "document";
    return String(documentName).toLowerCase();
  }

  creationSummary(documents = []) {
    const counts = documents.reduce((acc, document) => {
      const documentName = document?.documentName || document?.constructor?.documentName || "Document";
      acc[documentName] = (acc[documentName] ?? 0) + 1;
      return acc;
    }, {});

    const parts = Object.entries(counts).map(([documentName, count]) => {
      const label = String(documentName).toLowerCase();
      const plural = count === 1 ? label : `${label}s`;
      return `${count} ${plural}`;
    });

    return `Created ${parts.join(" and ")}.`;
  }
}
