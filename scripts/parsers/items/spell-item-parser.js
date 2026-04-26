import { BaseItemParser } from "./base-item-parser.js";

export class SpellItemParser extends BaseItemParser {
    static ITEM_TYPE = "spell";

    constructor({ text, type, folderId }) {
        super({ text, type, folderId });
    }

    parse() {
        if (!this.ensureText()) return null;

        const lines = this.splitCleanLines();
        if (!lines.length) {
            return this.toFoundryItem({
                name: "Unnamed Spell",
                meta: this.parseMetaLine(""),
                stats: this.parseStatLine(""),
                description: ""
            });
        }

        const name = lines[0];
        let index = 1;

        let metaLine = "";
        let statLine = "";

        if (lines[index] && /^\(.*\)$/.test(lines[index])) {
            metaLine = lines[index];
            index += 1;
        }

        if (lines[index] && this.looksLikeSpellHeaderLine(lines[index])) {
            index += 1;
        }

        if (lines[index] && this.looksLikeSpellStatLine(lines[index])) {
            statLine = lines[index];
            index += 1;
        }

        const descriptionLines = lines.slice(index);
        const meta = this.parseMetaLine(metaLine);
        const stats = this.parseStatLine(statLine);
        const description = this.linesToHtml(descriptionLines);

        return this.toFoundryItem({
            name,
            meta,
            stats,
            description
        });
    }

    looksLikeSpellHeaderLine(line) {
        const normalized = String(line ?? "").trim().toUpperCase().replace(/\s+/g, " ");
        return normalized.includes("RANGE")
            && normalized.includes("TYPE")
            && normalized.includes("DURATION")
            && normalized.includes("DV");
    }

    looksLikeSpellStatLine(line) {
        return Boolean(this.tokenizeStatLine(line).length >= 4);
    }

    parseMetaLine(line) {
        const raw = String(line ?? "").trim();
        if (!raw) {
            return {
                category: "health",
                categoryDetected: false,
                combatSpellType: "spells_indirect",
                area: false,
                multiSense: false
            };
        }

        const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
        const parts = inner.split(",").map((p) => p.trim()).filter(Boolean);
        const lower = parts.map((p) => p.toLowerCase());

        let category = "health";
        let categoryDetected = false;
        let combatSpellType = "";

        if (lower.some((p) => p.includes("combat"))) {
            category = "combat";
            categoryDetected = true;
        } else if (lower.some((p) => p.includes("detection"))) {
            category = "detection";
            categoryDetected = true;
        } else if (lower.some((p) => p.includes("health"))) {
            category = "health";
            categoryDetected = true;
        } else if (lower.some((p) => p.includes("illusion"))) {
            category = "illusion";
            categoryDetected = true;
        } else if (lower.some((p) => p.includes("manipulation"))) {
            category = "manipulation";
            categoryDetected = true;
        }

        if (lower.some((p) => p.includes("indirect combat"))) {
            combatSpellType = "spells_indirect";
        } else if (lower.some((p) => p.includes("direct combat"))) {
            combatSpellType = "spells_direct";
        }

        const area = lower.some((p) => p === "area" || p.includes("area"));
        const multiSense = lower.some((p) => p.includes("multi-sense") || p.includes("multisense"));

        return {
            category,
            categoryDetected,
            combatSpellType,
            area,
            multiSense
        };
    }

    parseStatLine(line) {
        const tokens = this.tokenizeStatLine(line);
        if (tokens.length < 4) {
            return {
                range: "self",
                type: "physical",
                duration: "instantaneous",
                drain: 0,
                damage: "physical",
                specialDamageText: ""
            };
        }

        const [rangeToken, typeToken, durationToken, drainToken, ...damageTokens] = tokens;
        const damageText = damageTokens.join(" ").trim();

        return {
            range: this.mapRange(rangeToken),
            type: this.mapSpellType(typeToken),
            duration: this.mapDuration(durationToken),
            drain: this.extractDrainValue(drainToken),
            damage: this.mapDamage(damageText, typeToken),
            specialDamageText: damageText
        };
    }

    tokenizeStatLine(line) {
        const raw = String(line ?? "").trim();
        if (!raw) return [];

        const normalized = raw
            .replace(/LOS\s*\(\s*A\s*\)/gi, "LOS_AREA")
            .replace(/(LOS_AREA|LOS|T|S)(?=[PM]\b)/gi, "$1 ")
            .replace(/([PM])(?=[ISP]\b)/g, "$1 ")
            .replace(/([ISP])(?=\d\b)/g, "$1 ")
            .replace(/\s+/g, " ")
            .trim();

        return normalized.split(/\s+/).filter(Boolean);
    }

    mapRange(rangeToken) {
        const r = String(rangeToken ?? "").trim().toUpperCase();

        if (r === "LOS_AREA" || r === "LOS(A)") return "line_of_sight_area";
        if (r === "LOS") return "line_of_sight";
        if (r === "T") return "touch";
        if (r === "S") return "self";

        return "self";
    }

    mapSpellType(typeToken) {
        const t = String(typeToken ?? "").trim().toUpperCase();

        if (t === "P") return "physical";
        if (t === "M") return "mana";

        return "physical";
    }

    mapDuration(durationToken) {
        const d = String(durationToken ?? "").trim().toUpperCase();

        if (d === "I") return "instantaneous";
        if (d === "S") return "sustained";
        if (d === "P") return "permanent";

        return "instantaneous";
    }

    extractDrainValue(token) {
        return this.extractFirstInteger(token, 0);
    }

    mapDamage(damageText, typeToken) {
        const dmg = String(damageText ?? "").trim().toUpperCase();
        const type = String(typeToken ?? "").trim().toUpperCase();

        if (dmg.startsWith("S")) return "stun";
        if (dmg.startsWith("P")) return "physical";

        if (type === "M") return "stun";
        return "physical";
    }

    buildWarnings(meta) {
        const warnings = [];

        if (!meta.categoryDetected) {
            warnings.push("Spell category could not be determined from the text. Please set the spell category manually on the item sheet.");
        }

        return warnings;
    }

    toFoundryItem({ name, meta, stats, description }) {
        return {
            name: name || "Unnamed Spell",
            type: "spell",
            img: "systems/shadowrun6-eden/icons/compendium/default/acid.svg",
            system: {
                genesisID: "",
                description: description ?? "",
                product: "",
                page: 0,
                category: meta.category || "health",
                duration: stats.duration || "instantaneous",
                drain: Number.isFinite(stats.drain) ? stats.drain : 0,
                type: stats.type || "physical",
                range: stats.range || "self",
                damage: stats.damage || "physical",
                alchemic: false,
                multiSense: Boolean(meta.multiSense),
                isOpposed: true,
                withEssence: true,
                wildDie: false,
                isSustained: stats.duration === "sustained",
                combatSpellType: meta.combatSpellType || "spells_indirect"
            },
            effects: [],
            folder: this.folderId ?? null,
            flags: {
                ["shadowrun-items-importer"]: {
                    specialDamageText: stats.specialDamageText || "",
                    warnings: this.buildWarnings(meta)
                }
            }
        };
    }
}
