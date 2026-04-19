import { SII } from "./constants.js";
import { ShadowrunItemsImporterConfig } from "./config.js";
import { ShadowrunItemsImporterUtils as Utils } from "./utils.js";
import { ShadowrunItemsImporterApp } from "./app.js";

Hooks.once("init", async () => {
  ShadowrunItemsImporterConfig.registerSettings();
  Utils.log("init");
});

Hooks.once("ready", async () => {
  if (!Utils.isSupportedSystem()) {
    ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.systemMismatch`));
  }
});

Hooks.on("renderItemDirectory", async (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const footer = root.querySelector(".directory-footer");
  if (!footer) return;
  if (footer.querySelector(`[data-module-button="${SII.MODULE_ID}"]`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-module-button", SII.MODULE_ID);
  button.innerHTML = `<i class="fa-solid fa-file-import"></i> ${game.i18n.localize(`${SII.MODULE_ID}.button.directory`)}`;
  button.addEventListener("click", async () => {
    await ShadowrunItemsImporterApp.show();
    ui.notifications?.info(game.i18n.localize(`${SII.MODULE_ID}.notifications.importerReady`));
  });

  footer.append(button);
});

export { ShadowrunItemsImporterApp };
