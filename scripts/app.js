import { SII } from "./constants.js";
import { ShadowrunItemsImporterUtils as Utils } from "./utils.js";
import { ShadowrunItemsImporterParser } from "./parser.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class ShadowrunImporterBaseApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static APP_INSTANCE = null;

  static async show(options = {}) {
    if (!this.APP_INSTANCE) this.APP_INSTANCE = new this(options);
    await this.APP_INSTANCE.render({ force: true });
    return this.APP_INSTANCE;
  }

  get rootElement() {
    return this.element;
  }

  getInputValue() {
    return this.rootElement?.querySelector("textarea[name='input']")?.value ?? "";
  }

  async importParsedDocuments({ input, parserType, itemFolderId = null }) {
    if (!input.trim()) {
      ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.missingInput`));
      return;
    }

    const parser = new ShadowrunItemsImporterParser();
    const parsedObject = await parser.parseInput(input, itemFolderId || null, parserType);
    if (!parsedObject) return;

    let parsedObjects = Array.isArray(parsedObject) ? parsedObject : [parsedObject];

    if (typeof this.beforeImportParsedDocuments === "function") {
      const preparedObjects = await this.beforeImportParsedDocuments(parsedObjects, { input, parserType, itemFolderId });
      if (!preparedObjects) return;
      parsedObjects = Array.isArray(preparedObjects) ? preparedObjects : [preparedObjects];
    }

    const createdDocuments = [];

    for (const documentData of parsedObjects) {
      const created = await this.createImportedDocument(documentData, itemFolderId || null);
      createdDocuments.push(created);

      const warnings = documentData.flags?.[SII.MODULE_ID]?.warnings ?? [];
      for (const warning of warnings) {
        ui.notifications?.warn(warning);
      }
    }

    if (createdDocuments.length === 1) {
      const label = this.labelForCreatedDocument(createdDocuments[0]);
      ui.notifications?.info(`Created ${label}: ${createdDocuments[0].name}`);
      await createdDocuments[0].sheet.render(true);
    } else {
      ui.notifications?.info(this.creationSummary(createdDocuments));
    }

    this.close();
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
    // Actors are intentionally created at actor-root level for now.
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

export class ShadowrunItemsImporterApp extends ShadowrunImporterBaseApp {
  static APP_INSTANCE = null;

  static DEFAULT_OPTIONS = {
    id: SII.APP_ID,
    tag: "section",
    classes: [SII.MODULE_ID, "window-app", "sii-item-window"],
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
      template: SII.TEMPLATES.ITEM_WINDOW
    }
  };

  async _prepareContext(_options) {
    const itemTypes = Utils.getItemTypeOptions();
    const folders = Utils.getItemFolders();
    const rememberFolder = game.settings.get(SII.MODULE_ID, SII.SETTINGS.REMEMBER_FOLDER);
    const lastFolderId = rememberFolder ? game.settings.get(SII.MODULE_ID, SII.SETTINGS.LAST_FOLDER) : "";

    const savedType = game.settings.get(SII.MODULE_ID, SII.SETTINGS.LAST_TYPE) || itemTypes[0]?.value || "";
    const legacyGearParts = savedType.startsWith("gear.") ? savedType.split(".") : [];
    const legacyModParts = savedType.startsWith("mod.") ? savedType.split(".") : [];
    const selectedItemType = legacyGearParts.length
      ? "gear"
      : (legacyModParts.length ? "mod" : savedType);

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

    const modSubtypeOptions = Utils.getModSubtypeOptions();
    const selectedModSubtype = game.settings.get(SII.MODULE_ID, SII.SETTINGS.LAST_MOD_SUBTYPE)
      || legacyModParts[1]
      || modSubtypeOptions[0]?.value
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
      itemTypes: itemTypes.map((type) => Utils.optionWithParserStatus({
        value: type.value,
        label: type.label,
        selected: type.value === selectedItemType
      }, Utils.isActiveItemParser(type.value))),
      isGearSelected: selectedItemType === "gear",
      isModSelected: selectedItemType === "mod",
      selectedItemTypeParserActive: Utils.isActiveItemParser(selectedItemType),
      selectedGearTypeParserActive: Utils.isActiveGearType(selectedGearType),
      selectedGearSubtypeParserActive: Utils.isActiveGearParser(selectedGearType, selectedGearSubtype),
      selectedModSubtypeParserActive: Utils.isActiveModParser(selectedModSubtype),
      gearTypes: gearTypeOptions.map((type) => Utils.optionWithParserStatus({
        value: type.value,
        label: type.label,
        selected: type.value === selectedGearType
      }, Utils.isActiveGearType(type.value))),
      gearSubtypes: gearSubtypeOptions.map((type) => Utils.optionWithParserStatus({
        value: type.value,
        label: type.label,
        selected: type.value === selectedGearSubtype
      }, Utils.isActiveGearParser(selectedGearType, type.value))),
      modSubtypes: modSubtypeOptions.map((type) => Utils.optionWithParserStatus({
        value: type.value,
        label: type.label,
        selected: type.value === selectedModSubtype
      }, Utils.isActiveModParser(type.value)))
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
    const modSubtypeSelect = root.querySelector("select[name='modSubtype']");
    const gearFields = root.querySelector(".sii-gear-fields");
    const modFields = root.querySelector(".sii-mod-fields");

    const setSelectParserStatus = (select, parserActive) => {
      if (!select) return;
      select.classList.toggle("sii-select-parser-active", Boolean(parserActive));
    };

    const refreshParserStatus = () => {
      const itemType = itemTypeSelect?.value ?? "";
      const gearType = gearTypeSelect?.value ?? "";
      const gearSubtype = gearSubtypeSelect?.value ?? "";
      const modSubtype = modSubtypeSelect?.value ?? "";
      const showGearFields = itemType === "gear";
      const showModFields = itemType === "mod";

      setSelectParserStatus(itemTypeSelect, Utils.isActiveItemParser(itemType));
      setSelectParserStatus(gearTypeSelect, showGearFields && Utils.isActiveGearType(gearType));
      setSelectParserStatus(gearSubtypeSelect, showGearFields && Utils.isActiveGearParser(gearType, gearSubtype));
      setSelectParserStatus(modSubtypeSelect, showModFields && Utils.isActiveModParser(modSubtype));
    };

    const refreshGearFields = () => {
      const itemType = itemTypeSelect?.value ?? "";
      const gearType = gearTypeSelect?.value ?? "";
      const previousSubtype = gearSubtypeSelect?.value ?? "";
      const showGearFields = itemType === "gear";
      const showModFields = itemType === "mod";

      if (gearFields) gearFields.style.display = showGearFields ? "" : "none";
      if (modFields) modFields.style.display = showModFields ? "" : "none";
      if (!gearSubtypeSelect) {
        refreshParserStatus();
        return;
      }

      gearSubtypeSelect.innerHTML = "";
      if (!showGearFields || !gearType) {
        refreshParserStatus();
        return;
      }

      const subtypeOptions = Utils.getGearSubtypeOptions(gearType);
      for (const option of subtypeOptions) {
        const parserActive = Utils.isActiveGearParser(gearType, option.value);
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label;
        el.selected = option.value === previousSubtype;
        el.dataset.parserActive = parserActive ? "true" : "false";
        el.classList.toggle("sii-option-parser-active", parserActive);
        gearSubtypeSelect.appendChild(el);
      }

      if (!gearSubtypeSelect.value && gearSubtypeSelect.options.length) {
        gearSubtypeSelect.options[0].selected = true;
      }

      refreshParserStatus();
    };

    itemTypeSelect?.addEventListener("change", refreshGearFields);
    gearTypeSelect?.addEventListener("change", refreshGearFields);
    gearSubtypeSelect?.addEventListener("change", refreshParserStatus);
    modSubtypeSelect?.addEventListener("change", refreshParserStatus);

    refreshGearFields();
  }

  static async onImportAction(_event, _target) {
    const app = ShadowrunItemsImporterApp.APP_INSTANCE;
    const root = app?.element;
    if (!app || !root) return;

    try {
      const input = app.getInputValue();
      const folderId = root.querySelector("select[name='folderId']")?.value ?? "";
      const baseType = root.querySelector("select[name='itemType']")?.value ?? "";
      const gearType = root.querySelector("select[name='gearType']")?.value ?? "";
      const gearSubtype = root.querySelector("select[name='gearSubtype']")?.value ?? "";
      const modSubtype = root.querySelector("select[name='modSubtype']")?.value ?? "";
      const parserType = baseType === "gear"
        ? `gear.${gearType}.${gearSubtype}`
        : (baseType === "mod" ? `mod.${modSubtype}` : baseType);

      if (game.settings.get(SII.MODULE_ID, SII.SETTINGS.REMEMBER_FOLDER)) {
        await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_FOLDER, folderId);
      }

      await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_TYPE, baseType);
      if (baseType === "gear") {
        await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_GEAR_TYPE, gearType);
        await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_GEAR_SUBTYPE, gearSubtype);
      }
      if (baseType === "mod") {
        await game.settings.set(SII.MODULE_ID, SII.SETTINGS.LAST_MOD_SUBTYPE, modSubtype);
      }

      await app.importParsedDocuments({ input, parserType, itemFolderId: folderId || null });
    } catch (error) {
      console.error("Shadowrun item importer failed", error);
      ui.notifications?.error(`Import failed: ${error.message}`);
    }
  }
}

export class ShadowrunActorsImporterApp extends ShadowrunImporterBaseApp {
  static APP_INSTANCE = null;

  static DEFAULT_OPTIONS = {
    id: SII.ACTOR_APP_ID,
    tag: "section",
    classes: [SII.MODULE_ID, "window-app", "sii-actor-window"],
    position: {
      width: 1220,
      height: 720
    },
    window: {
      title: `${SII.MODULE_ID}.actorTitle`,
      resizable: true,
      icon: "fa-solid fa-users"
    },
    actions: {
      previewActors: ShadowrunActorsImporterApp.onPreviewAction,
      importActors: ShadowrunActorsImporterApp.onImportAction
    }
  };

  static PARTS = {
    content: {
      template: SII.TEMPLATES.ACTOR_WINDOW
    }
  };

  async createActorDocument(actorData, actorFolderId = null) {
    const { actorData: preparedActorData, embeddedItems, summary } = this.prepareActorDataWithMatchedWorldItems(actorData);
    const created = await super.createActorDocument(preparedActorData, actorFolderId);

    if (embeddedItems.length) {
      await created.createEmbeddedDocuments("Item", embeddedItems);
    }

    if (summary.total) {
      const foundLabel = `${summary.found}/${summary.total}`;
      ui.notifications?.info(`Actor item lookup: ${foundLabel} world item entries embedded.`);
      if (summary.missing > 0) {
        ui.notifications?.warn(`Actor item lookup: ${summary.missing} parsed entries were not found in world items and were left in importer flags.`);
      }
    }

    return created;
  }

  prepareActorDataWithMatchedWorldItems(actorData) {
    const preparedActorData = foundry.utils.deepClone(actorData ?? {});
    const itemLookup = this.buildWorldItemLookup();
    const matchReport = this.collectWorldItemMatches(preparedActorData, itemLookup);
    const embeddedItems = [];

    for (const match of matchReport.foundEntries) {
      embeddedItems.push(this.toEmbeddedItemData(match.item, match));
    }

    const importSummary = {
      found: matchReport.foundEntries.length,
      missing: matchReport.missingEntries.length,
      total: matchReport.foundEntries.length + matchReport.missingEntries.length,
      embedded: embeddedItems.length,
      totalQuantity: matchReport.foundEntries.reduce((total, entry) => total + (entry.quantity ?? 1), 0),
      foundEntries: matchReport.foundEntries.map((entry) => ({
        section: entry.sectionKey,
        raw: entry.raw,
        matchedName: entry.item?.name ?? "",
        matchedUuid: entry.item?.uuid ?? "",
        quantity: entry.quantity
      })),
      missingEntries: matchReport.missingEntries.map((entry) => ({
        section: entry.sectionKey,
        raw: entry.raw,
        name: entry.name
      }))
    };

    foundry.utils.setProperty(preparedActorData, `flags.${SII.MODULE_ID}.worldItemImport`, importSummary);
    return { actorData: preparedActorData, embeddedItems, summary: importSummary };
  }

  collectWorldItemMatches(actorData, itemLookup = this.buildWorldItemLookup()) {
    const sections = actorData?.flags?.[SII.MODULE_ID]?.sections ?? {};
    const foundEntries = [];
    const missingEntries = [];

    for (const [sectionKey, entries] of Object.entries(sections)) {
      if (!this.isItemLookupSection(sectionKey) || !Array.isArray(entries)) continue;

      const selectedOptionalPowers = String(sectionKey ?? "").toLowerCase() === "optional_powers"
        ? this.selectedOptionalPowerKeys(actorData)
        : null;

      for (const entry of entries) {
        const normalizedEntry = entry && typeof entry === "object" ? entry : { raw: String(entry ?? ""), name: String(entry ?? "") };
        if (selectedOptionalPowers && !selectedOptionalPowers.has(this.optionalPowerKey(normalizedEntry))) continue;

        const match = this.resolveWorldItemForEntry(normalizedEntry, itemLookup, sectionKey);
        const quantity = this.entryQuantity(normalizedEntry.raw ?? normalizedEntry.name ?? "");
        const reportEntry = {
          sectionKey,
          raw: normalizedEntry.raw ?? normalizedEntry.name ?? "",
          name: normalizedEntry.name ?? normalizedEntry.raw ?? "",
          quantity
        };

        if (match?.item) foundEntries.push({ ...reportEntry, item: match.item, candidate: match.candidate });
        else missingEntries.push(reportEntry);
      }
    }

    return { foundEntries, missingEntries };
  }

  selectedOptionalPowerKeys(actorData) {
    const selected = actorData?.flags?.[SII.MODULE_ID]?.selectedOptionalPowers;
    if (!Array.isArray(selected) || !selected.length) return new Set();
    return new Set(selected.map((entry) => this.optionalPowerKey(entry)).filter(Boolean));
  }

  optionalPowerKey(entry) {
    const raw = entry && typeof entry === "object" ? (entry.raw ?? entry.name ?? "") : String(entry ?? "");
    const name = entry && typeof entry === "object" ? (entry.name ?? raw) : raw;

    // Optional powers can share the same base world-item name but differ by
    // qualifier, for example "Elemental Attack (Cold)" and
    // "Elemental Attack (Electricity)". The lookup still matches the base
    // item name, but the selected/allowed-set key must preserve the full raw
    // option so selecting one does not import every option with the same base.
    return this.normalizeItemLookupKey(raw || name);
  }

  async beforeImportParsedDocuments(parsedObjects) {
    const preparedObjects = [];

    for (const documentData of parsedObjects) {
      if (this.resolveDocumentType(documentData) !== "Actor" || documentData?.type !== "Spirit") {
        preparedObjects.push(documentData);
        continue;
      }

      const configured = await this.configureSpiritOptionalPowers(documentData);
      if (!configured) return null;
      preparedObjects.push(configured);
    }

    return preparedObjects;
  }

  async configureSpiritOptionalPowers(actorData) {
    const data = foundry.utils.deepClone(actorData ?? {});
    const flags = data.flags?.[SII.MODULE_ID] ?? {};
    const optionalPowers = flags.sections?.optional_powers ?? [];
    const force = Number(flags.spirit?.force ?? data.system?.rating ?? 0);
    const limit = Math.floor(force / 3);

    foundry.utils.setProperty(data, `flags.${SII.MODULE_ID}.selectedOptionalPowers`, []);

    if (!Array.isArray(optionalPowers) || !optionalPowers.length || limit <= 0) {
      if (Array.isArray(optionalPowers) && optionalPowers.length && limit <= 0) {
        ui.notifications?.info(game.i18n.format(`${SII.MODULE_ID}.spirit.noOptionalPowers`, { force }));
      }
      return data;
    }

    const selected = await this.promptSpiritOptionalPowers(optionalPowers, limit);
    if (selected === null) return null;

    foundry.utils.setProperty(data, `flags.${SII.MODULE_ID}.selectedOptionalPowers`, selected);
    return data;
  }

  async promptSpiritOptionalPowers(optionalPowers, limit) {
    const itemLookup = this.buildWorldItemLookup();
    const rows = optionalPowers.map((entry, index) => {
      const normalizedEntry = entry && typeof entry === "object" ? entry : { raw: String(entry ?? ""), name: String(entry ?? "") };
      const match = this.resolveWorldItemForEntry(normalizedEntry, itemLookup, "optional_powers");
      const label = normalizedEntry.raw ?? normalizedEntry.name ?? "";
      const foundClass = match ? "sii-spirit-optional-found" : "sii-spirit-optional-missing";
      const disabled = match ? "" : " disabled";
      const title = match?.item?.uuid ? ` title="${this.escapeHtml(match.item.uuid)}"` : "";
      return `<label class="sii-spirit-optional-row ${foundClass}"${title}>
        <input type="checkbox" name="optionalPower" value="${index}"${disabled}>
        <span>${this.escapeHtml(label)}</span>
      </label>`;
    }).join("");

    const content = `<form class="sii-spirit-optional-dialog" data-limit="${Number(limit)}">
      <p>${this.escapeHtml(game.i18n.format(`${SII.MODULE_ID}.spirit.optionalPowersIntro`, { limit }))}</p>
      <div class="sii-spirit-optional-counter">${this.escapeHtml(game.i18n.format(`${SII.MODULE_ID}.spirit.optionalPowersCounter`, { selected: 0, limit }))}</div>
      <div class="sii-spirit-optional-list">${rows}</div>
      <p class="notes">${this.escapeHtml(game.i18n.localize(`${SII.MODULE_ID}.spirit.optionalPowersLegend`))}</p>
    </form>`;

    return new Promise((resolve) => {
      const dialog = new Dialog({
        title: game.i18n.localize(`${SII.MODULE_ID}.spirit.optionalPowersTitle`),
        content,
        buttons: {
          cancel: {
            icon: '<i class="fa-solid fa-xmark"></i>',
            label: game.i18n.localize("Cancel"),
            callback: () => resolve(null)
          },
          import: {
            icon: '<i class="fa-solid fa-check"></i>',
            label: game.i18n.localize(`${SII.MODULE_ID}.button.importActor`),
            callback: (html) => {
              const root = html?.[0] ?? html;
              const indexes = Array.from(root?.querySelectorAll?.("input[name='optionalPower']:checked") ?? [])
                .slice(0, limit)
                .map((input) => Number(input.value))
                .filter((index) => Number.isInteger(index) && index >= 0);

              resolve(indexes.map((index) => optionalPowers[index]).filter(Boolean));
            }
          }
        },
        default: "import",
        close: () => resolve(null)
      });

      dialog.render(true);
      this.activateSpiritOptionalPowerLimit(dialog, limit);
    });
  }

  activateSpiritOptionalPowerLimit(dialog, limit) {
    const attach = () => {
      const root = dialog.element?.[0] ?? dialog.element;
      const form = root?.querySelector?.(".sii-spirit-optional-dialog");
      if (!form) {
        window.setTimeout(attach, 25);
        return;
      }

      const checkboxes = Array.from(form.querySelectorAll("input[name='optionalPower']"));
      const counter = form.querySelector(".sii-spirit-optional-counter");

      const refresh = () => {
        const checked = checkboxes.filter((input) => input.checked);
        const selected = checked.length;
        if (counter) {
          counter.textContent = game.i18n.format(`${SII.MODULE_ID}.spirit.optionalPowersCounter`, { selected, limit });
          counter.classList.toggle("sii-spirit-optional-over-limit", selected > limit);
        }

        for (const input of checkboxes) {
          const unavailable = input.closest(".sii-spirit-optional-missing") !== null;
          input.disabled = unavailable || (!input.checked && selected >= limit);
        }
      };

      for (const input of checkboxes) {
        input.addEventListener("change", () => {
          const checked = checkboxes.filter((checkbox) => checkbox.checked);
          if (checked.length > limit) {
            input.checked = false;
            ui.notifications?.warn(game.i18n.format(`${SII.MODULE_ID}.spirit.optionalPowersTooMany`, { limit }));
          }
          refresh();
        });
      }

      refresh();
    };

    attach();
  }

  toEmbeddedItemData(item, match) {
    const sourceData = typeof item?.toObject === "function" ? item.toObject() : item;
    const embeddedData = foundry.utils.deepClone(sourceData ?? {});
    const quantity = match?.quantity ?? 1;

    delete embeddedData._id;
    delete embeddedData.folder;
    delete embeddedData.sort;
    delete embeddedData.ownership;
    delete embeddedData._stats;

    if (Array.isArray(embeddedData.effects)) {
      embeddedData.effects = embeddedData.effects.map((effect) => {
        const effectData = foundry.utils.deepClone(effect);
        delete effectData._id;
        delete effectData.parent;
        delete effectData.sort;
        delete effectData.ownership;
        delete effectData._stats;
        return effectData;
      });
    }

    this.applyEmbeddedItemQuantity(embeddedData, quantity);

    embeddedData.flags = embeddedData.flags ?? {};
    embeddedData.flags[SII.MODULE_ID] = {
      ...(embeddedData.flags[SII.MODULE_ID] ?? {}),
      importedFromWorldItem: {
        uuid: item?.uuid ?? "",
        name: item?.name ?? embeddedData.name ?? "",
        section: match?.sectionKey ?? "",
        raw: match?.raw ?? "",
        candidate: match?.candidate ?? "",
        quantity
      }
    };

    return embeddedData;
  }

  applyEmbeddedItemQuantity(embeddedData, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity <= 1) return;

    embeddedData.system = embeddedData.system ?? {};
    embeddedData.system.count = String(quantity);
    embeddedData.system.countable = true;
  }

  entryQuantity(value) {
    const match = String(value ?? "").match(/^(\d+)\s*x\s+/iu);
    if (!match) return 1;

    const quantity = Number(match[1]);
    if (!Number.isInteger(quantity) || quantity < 1) return 1;

    // Keep runaway OCR/paste mistakes from creating hundreds of embedded items.
    return Math.min(quantity, 20);
  }

  async _prepareContext(_options) {
    return {
      moduleId: SII.MODULE_ID,
      title: game.i18n.localize(`${SII.MODULE_ID}.actorTitle`),
      actorTypes: [
        { value: "NPC", label: "NPC", selected: true },
        { value: "Critter", label: "Critter", selected: false },
        { value: "Spirit", label: "Spirit", selected: false }
      ]
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    const textarea = root.querySelector("textarea[name='input']");
    if (textarea && !textarea.value && game.settings.get(SII.MODULE_ID, SII.SETTINGS.DEBUG)) {
      textarea.value = `HUMANIS GOON\nB A R S W L I C ESS\n2 2 2 2 2 2 2 1 6\nDR I/ID AC CM MOVE\n2 4/1 A1, I2 9 10/15/+1\nSkills: Athletics 1, Close Combat 3, Influence 1 (Intimidation +2)\nGear: Commlink (Device Rating 1)\nWeapons:\nClub [Club, DV 3S, Attack Ratings 6/—/—/—/—]`;
    }

    const actorTypeSelect = root.querySelector("select[name='actorType']");
    const spiritForceField = root.querySelector(".sii-spirit-force-field");

    const refreshSpiritForceField = () => {
      if (!spiritForceField) return;
      spiritForceField.style.display = actorTypeSelect?.value === "Spirit" ? "" : "none";
    };

    actorTypeSelect?.addEventListener("change", () => {
      refreshSpiritForceField();
      this.markActorPreviewStale();
    });

    root.querySelector("input[name='spiritForce']")?.addEventListener("input", () => this.markActorPreviewStale());
    textarea?.addEventListener("input", () => this.markActorPreviewStale());
    refreshSpiritForceField();
  }

  actorParserTypeForCurrentSelection() {
    const root = this.element;
    const actorType = root?.querySelector("select[name='actorType']")?.value ?? "NPC";
    if (actorType !== "Spirit") return `actor.${actorType}`;

    const force = this.getSpiritForceInput();
    if (!force) throw new Error(game.i18n.localize(`${SII.MODULE_ID}.spirit.forceRequired`));
    return `actor.Spirit.force.${force}`;
  }

  getSpiritForceInput() {
    const root = this.element;
    const rawForce = root?.querySelector("input[name='spiritForce']")?.value ?? "";
    const force = Number(rawForce);
    return Number.isInteger(force) && force > 0 ? force : 0;
  }

  markActorPreviewStale() {
    const root = this.element;
    const preview = root?.querySelector(".sii-actor-preview");
    const status = root?.querySelector(".sii-preview-status");
    const textarea = root?.querySelector("textarea[name='input']");

    if (!preview || !textarea || !this._actorPreviewSource) return;
    if (textarea.value === this._actorPreviewSource) return;

    preview.classList.add("sii-preview-stale");
    if (status) {
      status.textContent = game.i18n.localize(`${SII.MODULE_ID}.preview.stale`);
      status.classList.add("sii-preview-status-stale");
    }
  }

  async renderActorPreview() {
    const root = this.element;
    if (!root) return;

    const input = this.getInputValue();
    const preview = root.querySelector(".sii-actor-preview");
    const status = root.querySelector(".sii-preview-status");
    const actorType = root.querySelector("select[name='actorType']")?.value ?? "NPC";

    if (!input.trim()) {
      ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.missingInput`));
      return;
    }

    if (preview) {
      preview.classList.remove("sii-preview-stale");
      preview.innerHTML = this.actorPreviewBusyHtml();
    }
    if (status) {
      status.textContent = game.i18n.localize(`${SII.MODULE_ID}.preview.parsing`);
      status.classList.remove("sii-preview-status-stale");
    }

    try {
      const parser = new ShadowrunItemsImporterParser();
      const parserType = this.actorParserTypeForCurrentSelection();
      const parsedObject = await parser.parseInput(input, null, parserType);
      if (!parsedObject) return;

      const actorData = Array.isArray(parsedObject) ? parsedObject[0] : parsedObject;
      this._actorPreviewSource = input;

      const itemLookup = this.buildWorldItemLookup();
      const itemMatchSummary = this.summarizeItemMatches(actorData, itemLookup);

      if (preview) preview.innerHTML = this.actorPreviewHtml(actorData, itemLookup);
      if (status) {
        const readyLabel = game.i18n.localize(`${SII.MODULE_ID}.preview.ready`);
        status.textContent = itemMatchSummary.total
          ? `${readyLabel} · ${game.i18n.format(`${SII.MODULE_ID}.preview.worldItemsFound`, itemMatchSummary)}`
          : readyLabel;
      }
    } catch (error) {
      console.error("Shadowrun actor preview failed", error);
      if (preview) preview.innerHTML = this.actorPreviewErrorHtml(error);
      if (status) status.textContent = game.i18n.localize(`${SII.MODULE_ID}.preview.failed`);
      ui.notifications?.error(`Preview failed: ${error.message}`);
    }
  }

  actorPreviewBusyHtml() {
    return `<div class="sii-preview-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> ${this.escapeHtml(game.i18n.localize(`${SII.MODULE_ID}.preview.parsing`))}</div>`;
  }

  actorPreviewErrorHtml(error) {
    return `<div class="sii-preview-error"><strong>${this.escapeHtml(game.i18n.localize(`${SII.MODULE_ID}.preview.failed`))}</strong><p>${this.escapeHtml(error?.message ?? String(error))}</p></div>`;
  }

  actorPreviewHtml(actorData, itemLookup = this.buildWorldItemLookup()) {
    const importerFlags = actorData?.flags?.[SII.MODULE_ID] ?? {};
    const statBlock = importerFlags.statBlock ?? {};
    const sections = importerFlags.sections ?? {};
    const warnings = importerFlags.warnings ?? [];
    const primaryAttributes = statBlock.primary?.attributes ?? {};
    const secondaryStats = statBlock.secondary ?? {};
    const actorName = actorData?.name || `Unnamed ${actorData?.type ?? "Actor"}`;
    const system = actorData?.system ?? {};

    const blocks = [
      `<div class="sii-preview-card sii-preview-actor-card">
        <div class="sii-preview-card-title">${this.recognized(actorName)}</div>
        <div class="sii-preview-card-subtitle">${this.escapeHtml(actorData?.type ?? "NPC")} · ${this.escapeHtml(system.mortype ?? "mundane")}</div>
      </div>`,
      this.attributePreviewHtml(primaryAttributes),
      this.secondaryPreviewHtml(secondaryStats),
      this.skillPreviewHtml(sections.skills ?? []),
      this.sectionPreviewHtml(sections, itemLookup),
      this.warningPreviewHtml(warnings)
    ].filter(Boolean);

    return `<div class="sii-preview-content">${blocks.join("")}</div>`;
  }

  attributePreviewHtml(attributes = {}) {
    const labels = [
      ["bod", "BOD"],
      ["agi", "AGI"],
      ["rea", "REA"],
      ["str", "STR"],
      ["wil", "WIL"],
      ["log", "LOG"],
      ["int", "INT"],
      ["cha", "CHA"],
      ["mag", "MAG"],
      ["essence", "ESS"]
    ];

    const chips = labels
      .filter(([id]) => attributes[id])
      .map(([id, label]) => id === "essence"
        ? this.statChip(label, this.formatEssenceStatValue(attributes[id]), { acknowledged: true })
        : this.statChip(label, this.formatStatValue(attributes[id])));

    if (!chips.length) return "";
    return this.previewCard(game.i18n.localize(`${SII.MODULE_ID}.preview.primaryStats`), `<div class="sii-chip-grid">${chips.join("")}</div>`);
  }

  secondaryPreviewHtml(stats = {}) {
    if (!Object.keys(stats).length) return "";

    const chips = [
      this.statChip("DR", stats.defenseRating),
      this.statChip("I/ID", `${stats.initiative ?? 0}/${stats.initiativeDice ?? 0}`),
      stats.astralInitiative !== undefined ? this.statChip("Astral I/ID", `${stats.astralInitiative}/${stats.astralInitiativeDice ?? 0}`) : "",
      stats.actions ? this.statChip("AC", stats.actions) : "",
      this.statChip("CM", stats.stunMonitor && stats.stunMonitor !== stats.conditionMonitor ? `${stats.conditionMonitor ?? ""}/${stats.stunMonitor}` : (stats.conditionMonitor ?? "")),
      Number.isFinite(stats.walk) && Number.isFinite(stats.sprint) ? this.statChip("MOVE", `${stats.walk}/${stats.sprint}/${stats.perHit ?? 0}`) : ""
    ].filter(Boolean);

    const sourceNote = stats.source === "derived"
      ? `<p class="sii-preview-detail">${this.escapeHtml(game.i18n.localize(`${SII.MODULE_ID}.preview.derivedSecondaryStats`))}</p>`
      : "";
    const movementNote = stats.movementNote
      ? `<p class="sii-preview-detail">${this.recognized(`Extra movement: ${stats.movementNote}`)}</p>`
      : "";

    return this.previewCard(game.i18n.localize(`${SII.MODULE_ID}.preview.secondaryStats`), `<div class="sii-chip-grid">${chips.join("")}</div>${sourceNote}${movementNote}`);
  }

  skillPreviewHtml(skills = []) {
    if (!Array.isArray(skills) || !skills.length) return "";

    const entries = skills.map((skill) => {
      const specialization = skill.specialization ? ` <span class="sii-preview-detail">(${this.escapeHtml(skill.specialization)} +${this.escapeHtml(skill.specializationBonus ?? 2)})</span>` : "";
      return `<li>${this.recognized(`${skill.name} ${skill.points}`)}${specialization}</li>`;
    });

    return this.previewCard(game.i18n.localize(`${SII.MODULE_ID}.preview.skills`), `<ul class="sii-preview-list">${entries.join("")}</ul>`);
  }

  sectionPreviewHtml(sections = {}, itemLookup = this.buildWorldItemLookup()) {
    const ignored = new Set(["skills"]);
    const entries = Object.entries(sections).filter(([key, value]) => !ignored.has(key) && Array.isArray(value) && value.length);
    if (!entries.length) return "";

    const content = entries.map(([key, value]) => {
      const title = this.sectionTitle(key);
      const items = value.map((entry) => this.sectionEntryHtml(entry, itemLookup, key)).join("");
      return `<section class="sii-preview-section"><h4>${this.escapeHtml(title)}</h4><ul class="sii-preview-list">${items}</ul></section>`;
    }).join("");

    return this.previewCard(game.i18n.localize(`${SII.MODULE_ID}.preview.sections`), content);
  }

  sectionEntryHtml(entry, itemLookup = this.buildWorldItemLookup(), sectionKey = "") {
    const normalizedEntry = entry && typeof entry === "object" ? entry : { raw: String(entry ?? ""), name: String(entry ?? "") };

    if (!this.isItemLookupSection(sectionKey)) {
      const recognizedText = normalizedEntry.raw ?? normalizedEntry.name ?? "";
      return `<li>${this.recognized(recognizedText)}</li>`;
    }

    const match = this.resolveWorldItemForEntry(normalizedEntry, itemLookup, sectionKey);

    if (match) {
      const quantityPrefix = this.quantityPrefix(normalizedEntry.raw ?? normalizedEntry.name ?? "");
      const displayName = `${quantityPrefix}${match.item.name}`;
      return `<li>${this.worldItemFound(displayName, match.item)}</li>`;
    }

    const missingText = normalizedEntry.raw ?? normalizedEntry.name ?? "";
    return `<li>${this.worldItemMissing(missingText)}</li>`;
  }

  isItemLookupSection(sectionKey = "") {
    return new Set([
      "gear",
      "weapons",
      "spells",
      "augmentations",
      "programs",
      "qualities",
      "powers",
      "optional_powers",
      "weaknesses",
      "adept_powers",
      "vehicles"
    ]).has(String(sectionKey ?? "").toLowerCase());
  }

  buildWorldItemLookup() {
    const byName = new Map();
    const items = game.items?.contents ?? Array.from(game.items ?? []);

    for (const item of items) {
      const itemName = item?.name ?? "";
      for (const candidate of [itemName, this.stripSearchTypeWords(itemName)]) {
        const key = this.normalizeItemLookupKey(candidate);
        if (!key || byName.has(key)) continue;
        byName.set(key, item);
      }
    }

    return { byName };
  }

  summarizeItemMatches(actorData, itemLookup = this.buildWorldItemLookup()) {
    const sections = actorData?.flags?.[SII.MODULE_ID]?.sections ?? {};
    let found = 0;
    let total = 0;

    for (const [key, value] of Object.entries(sections)) {
      if (!this.isItemLookupSection(key) || !Array.isArray(value)) continue;
      for (const entry of value) {
        total += 1;
        if (this.resolveWorldItemForEntry(entry, itemLookup, key)) found += 1;
      }
    }

    return { found, total };
  }

  resolveWorldItemForEntry(entry, itemLookup = this.buildWorldItemLookup(), sectionKey = "") {
    if (!entry) return null;
    const candidates = this.itemNameCandidates(entry, sectionKey);

    for (const candidate of candidates) {
      const key = this.normalizeItemLookupKey(candidate);
      const item = itemLookup.byName.get(key);
      if (item) return { item, candidate };
    }

    return null;
  }

  itemNameCandidates(entry, sectionKey = "") {
    const raw = String(entry?.raw ?? entry?.name ?? "").trim();
    const name = String(entry?.name ?? raw).trim();
    const candidates = [];
    const add = (value) => {
      const cleaned = String(value ?? "").replace(/\s+/gu, " ").trim();
      if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
    };

    const sourceValues = [raw, name].filter(Boolean);
    const trailingRating = this.extractTrailingEntryRating(sourceValues, sectionKey);
    const rating = this.extractEntryRating(sourceValues) ?? trailingRating?.rating ?? null;

    // Rating-specific candidates must be tried before generic names.
    // Example: "Commlink (Device Rating 1)" should first try
    // "Commlink Rating 1", because many imported rating items are named as
    // "<name> Rating <n>".
    if (rating) {
      for (const value of sourceValues) {
        for (const base of this.itemBaseNameVariants(value, sectionKey)) {
          add(`${base} Rating ${rating}`);
          add(`${this.stripSearchTypeWords(base)} Rating ${rating}`);
        }
      }
    }

    for (const value of sourceValues) {
      let candidate = String(value ?? "").trim();
      if (!candidate) continue;

      candidate = candidate.replace(/^\d+\s*x\s+/iu, "").trim();
      add(candidate);
      add(this.stripSearchTypeWords(candidate));
      add(this.stripTrailingEntryRating(candidate, sectionKey));

      candidate = candidate.replace(/\s*\[[\s\S]*$/u, "").trim();
      add(candidate);
      add(this.stripSearchTypeWords(candidate));
      add(this.stripTrailingEntryRating(candidate, sectionKey));

      candidate = candidate.replace(/\s*\([\s\S]*\)$/u, "").trim();
      add(candidate);
      add(this.stripSearchTypeWords(candidate));
      add(this.stripTrailingEntryRating(candidate, sectionKey));

      const beforeWith = candidate.split(/\s+w\/\s+|\s+with\s+/iu)[0]?.trim();
      add(beforeWith);
      add(this.stripSearchTypeWords(beforeWith));

      add(candidate.replace(/\b(?:device\s+rating|rating|dr)\s*\d+\b/igu, "").trim());
      add(candidate.replace(/\s+\+\d+$/u, "").trim());
    }

    return candidates;
  }

  itemBaseNameVariants(value, sectionKey = "") {
    const variants = [];
    const add = (candidate) => {
      const cleaned = String(candidate ?? "").replace(/\s+/gu, " ").trim();
      if (cleaned && !variants.includes(cleaned)) variants.push(cleaned);
    };

    let candidate = String(value ?? "").trim();
    if (!candidate) return variants;

    candidate = candidate.replace(/^\d+\s*x\s+/iu, "").trim();
    candidate = candidate.split(/\s+w\/\s+|\s+with\s+/iu)[0]?.trim() ?? candidate;
    candidate = candidate.replace(/\s*\[[\s\S]*$/u, "").trim();
    candidate = candidate.replace(/\b(?:device\s+rating|rating|dr)\s*\d+\b/igu, "").trim();
    candidate = candidate.replace(/\s*\([^)]*\b(?:device\s+rating|rating|dr)\b[^)]*\)\s*$/iu, "").trim();
    candidate = candidate.replace(/\s*\([^)]*\)\s*$/u, "").trim();
    candidate = this.stripTrailingEntryRating(candidate, sectionKey);

    add(candidate);
    add(this.stripSearchTypeWords(candidate));

    return variants;
  }

  extractEntryRating(values = []) {
    const joined = Array.isArray(values) ? values.join(" ") : String(values ?? "");
    const match = String(joined ?? "").match(/\b(?:device\s+rating|rating|dr)\s*[:=]?\s*(\d+)\b/iu);
    if (!match) return null;

    const rating = Number(match[1]);
    return Number.isInteger(rating) && rating > 0 ? rating : null;
  }

  extractTrailingEntryRating(values = [], sectionKey = "") {
    if (!this.sectionAllowsTrailingRating(sectionKey)) return null;

    for (const value of Array.isArray(values) ? values : [values]) {
      const candidate = String(value ?? "")
        .replace(/^\d+\s*x\s+/iu, "")
        .replace(/\s*\[[\s\S]*$/u, "")
        .replace(/\s*\([^)]*\)\s*$/u, "")
        .trim();
      const match = candidate.match(/^(.+?)\s+(\d+)$/u);
      if (!match) continue;

      const rating = Number(match[2]);
      if (Number.isInteger(rating) && rating > 0) return { base: match[1].trim(), rating };
    }

    return null;
  }

  stripTrailingEntryRating(value, sectionKey = "") {
    if (!this.sectionAllowsTrailingRating(sectionKey)) return String(value ?? "").trim();
    return String(value ?? "").replace(/\s+\d+$/u, "").trim();
  }

  sectionAllowsTrailingRating(sectionKey = "") {
    return ["augmentations", "cyberware", "bioware", "powers", "optional_powers", "weaknesses"].includes(String(sectionKey ?? "").toLowerCase());
  }

  stripSearchTypeWords(value) {
    const original = String(value ?? "").replace(/\s+/gu, " ").trim();
    if (!original) return "";

    const stripped = original
      .replace(/\b(?:cyberdeck|cyberdecks|deck|decks|rcc|rigger\s+command\s+console)\b/igu, " ")
      .replace(/\b(?:vehicle|vehicles|car|cars|bike|bikes|truck|trucks|van|vans|boat|boats)\b/igu, " ")
      .replace(/\b(?:submarine|submarines|aircraft|rotorcraft|vtol|vstol)\b/igu, " ")
      .replace(/\b(?:microdrone|microdrones|minidrone|minidrones|small\s+drone|small\s+drones|medium\s+drone|medium\s+drones|large\s+drone|large\s+drones|drone|drones)\b/igu, " ")
      .replace(/\b(?:program|programs|software|spell|spells)\b/igu, " ")
      .replace(/\s+/gu, " ")
      .trim();

    // Do not turn generic entries such as "Commlink", "RCC", or "Drone" into
    // an empty search string. In those cases the generic name is still the best
    // available candidate.
    return stripped || original;
  }

  normalizeItemLookupKey(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[’']/gu, "")
      .replace(/&/gu, "and")
      .replace(/[^a-z0-9]+/gu, "")
      .trim();
  }

  quantityPrefix(value) {
    const match = String(value ?? "").match(/^(\d+)\s*x\s+/iu);
    return match ? `${match[1]} × ` : "";
  }

  worldItemFound(value, item) {
    const tooltip = item?.uuid ? ` title="${this.escapeHtml(item.uuid)}"` : "";
    return `<span class="sii-preview-worlditem-found"${tooltip}><i class="fa-solid fa-circle-check"></i> ${this.escapeHtml(value)}</span>`;
  }

  worldItemMissing(value) {
    return `<span class="sii-preview-worlditem-missing"><i class="fa-solid fa-circle-xmark"></i> ${this.escapeHtml(value)}</span>`;
  }

  warningPreviewHtml(warnings = []) {
    if (!Array.isArray(warnings) || !warnings.length) return "";

    const entries = warnings.map((warning) => `<li><span class="sii-preview-warning-token">${this.escapeHtml(warning)}</span></li>`).join("");
    return this.previewCard(game.i18n.localize(`${SII.MODULE_ID}.preview.warnings`), `<ul class="sii-preview-list">${entries}</ul>`);
  }

  previewCard(title, content) {
    return `<div class="sii-preview-card"><h3>${this.escapeHtml(title)}</h3>${content}</div>`;
  }

  statChip(label, value, { acknowledged = false } = {}) {
    const renderedValue = acknowledged ? this.acknowledged(value) : this.recognized(value);
    return `<span class="sii-stat-chip"><strong>${this.escapeHtml(label)}</strong> ${renderedValue}</span>`;
  }

  recognized(value) {
    return `<span class="sii-preview-recognized">${this.escapeHtml(value)}</span>`;
  }

  acknowledged(value) {
    return `<span class="sii-preview-acknowledged">${this.escapeHtml(value)}</span>`;
  }

  formatStatValue(value = {}) {
    const base = value.base ?? 0;
    const pool = value.pool ?? base;
    const augment = value.augment ?? 0;
    if (augment) return `${base} → ${pool} (${augment > 0 ? "+" : ""}${augment})`;
    return base;
  }

  formatEssenceStatValue(value = {}) {
    const parsed = this.formatStatValue(value);
    if (value.formula && /F/i.test(String(value.formula))) return `${value.formula} → ${parsed}`;
    return `${parsed} understood; actor starts at 6`;
  }

  sectionTitle(key) {
    return String(key ?? "")
      .replace(/_/gu, " ")
      .replace(/\b\w/gu, (letter) => letter.toUpperCase());
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }

  static async onPreviewAction(_event, _target) {
    const app = ShadowrunActorsImporterApp.APP_INSTANCE;
    if (!app) return;
    await app.renderActorPreview();
  }

  static async onImportAction(_event, _target) {
    const app = ShadowrunActorsImporterApp.APP_INSTANCE;
    const root = app?.element;
    if (!app || !root) return;

    try {
      const input = app.getInputValue();
      const parserType = app.actorParserTypeForCurrentSelection();
      await app.importParsedDocuments({ input, parserType, itemFolderId: null });
    } catch (error) {
      console.error("Shadowrun actor importer failed", error);
      ui.notifications?.error(`Import failed: ${error.message}`);
    }
  }
}
