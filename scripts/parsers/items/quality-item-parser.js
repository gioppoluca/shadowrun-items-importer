import { BaseItemParser } from "./base-item-parser.js";

export class QualityItemParser extends BaseItemParser {
    static ITEM_TYPE = "quality";

    constructor({ text, type, folderId }) {
        super({ text, type, folderId });
    }

    parse() {
        if (!this.ensureText()) return null;

        const lines = this.splitCleanLines();
        if (!lines.length) {
            return this.toFoundryItem({
                name: "Unnamed Quality",
                description: "",
                gameEffect: "",
                karma: 0,
                category: "ADVANTAGE"
            });
        }

        const name = lines[0];
        const remaining = lines.slice(1);

        let descriptionLines = [];
        let gameEffectLines = [];
        let currentSection = "description";
        let karma = 0;
        let category = "ADVANTAGE";

        for (const rawLine of remaining) {
            const parsedField = this.parseFieldLine(rawLine);

            if (parsedField) {
                const label = this.normalizeLabel(parsedField.label);
                const value = parsedField.value;

                if (label === "cost" || label === "karma cost") {
                    karma = this.extractFirstInteger(value, 0);
                    category = "ADVANTAGE";
                    currentSection = "description";
                    continue;
                }

                if (label === "bonus" || label === "karma bonus") {
                    karma = this.extractFirstInteger(value, 0);
                    category = "DISADVANTAGE";
                    currentSection = "description";
                    continue;
                }

                if (label === "game effect" || label === "game effects" || label === "effect" || label === "effects") {
                    currentSection = "gameEffect";
                    if (value) gameEffectLines.push(value);
                    continue;
                }
            }

            const cleaned = this.stripBulletMarker(rawLine);

            if (!cleaned) continue;

            if (currentSection === "gameEffect") {
                gameEffectLines.push(cleaned);
            } else {
                descriptionLines.push(cleaned);
            }
        }

        const description = this.joinWrappedText(descriptionLines);
        const gameEffect = this.joinWrappedText(gameEffectLines);

        // Fallback heuristic: if no explicit Game Effect section exists,
        // keep explain aligned with description instead of failing.
        return this.toFoundryItem({
            name,
            description,
            gameEffect,
            karma,
            category
        });
    }

    joinWrappedText(lines = []) {
        return lines
            .map((line) => String(line ?? "").trim())
            .filter((line) => line.length > 0)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    toFoundryItem({ name, description, gameEffect, karma, category }) {
        return {
            name: name || "Unnamed Quality",
            type: "quality",
            img: "systems/shadowrun6-eden/icons/compendium/default/Default_Skill.svg",
            system: {
                genesisID: "",
                description: description ?? "",
                product: "",
                page: 0,
                value: Number.isFinite(karma) ? karma : 0,
                explain: gameEffect || description || "",
                modifier: [],
                category: category || "ADVANTAGE",
                level: false
            },
            effects: [],
            folder: this.folderId ?? null,
            flags: {}
        };
    }
}