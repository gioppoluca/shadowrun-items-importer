import { SII } from "./constants.js";
import { ShadowrunItemsImporterConfig } from "./config.js";
import { ShadowrunItemsImporterUtils as Utils } from "./utils.js";
import { ShadowrunActorsImporterApp, ShadowrunItemsImporterApp } from "./app.js";

Hooks.once("init", async () => {
  ShadowrunItemsImporterConfig.registerSettings();
  Utils.log("init");
});

Hooks.once("ready", async () => {
  if (!Utils.isSupportedSystem()) {
    ui.notifications?.warn(game.i18n.localize(`${SII.MODULE_ID}.notifications.systemMismatch`));
  }
});

function htmlRoot(html) {
  return html instanceof HTMLElement ? html : html?.[0];
}

function addDirectoryImporterButton(html, { marker, labelKey, readyKey, icon, onClick }) {
  const root = htmlRoot(html);
  if (!root) return;

  const footer = root.querySelector(".directory-footer");
  if (!footer) return;
  if (footer.querySelector(`[data-module-button="${marker}"]`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-module-button", marker);
  button.innerHTML = `<i class="${icon}"></i> ${game.i18n.localize(labelKey)}`;
  button.addEventListener("click", async () => {
    await onClick();
    ui.notifications?.info(game.i18n.localize(readyKey));
  });

  footer.append(button);
}

Hooks.on("renderItemDirectory", async (_app, html) => {
  addDirectoryImporterButton(html, {
    marker: `${SII.MODULE_ID}-items`,
    labelKey: `${SII.MODULE_ID}.button.directoryItems`,
    readyKey: `${SII.MODULE_ID}.notifications.itemImporterReady`,
    icon: "fa-solid fa-file-import",
    onClick: () => ShadowrunItemsImporterApp.show()
  });
});

Hooks.on("renderActorDirectory", async (_app, html) => {
  addDirectoryImporterButton(html, {
    marker: `${SII.MODULE_ID}-actors`,
    labelKey: `${SII.MODULE_ID}.button.directoryActors`,
    readyKey: `${SII.MODULE_ID}.notifications.actorImporterReady`,
    icon: "fa-solid fa-users",
    onClick: () => ShadowrunActorsImporterApp.show()
  });
});

export { ShadowrunActorsImporterApp, ShadowrunItemsImporterApp };
