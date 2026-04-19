import { BaseItemParser } from "./base-item-parser.js";

export class MetamagicItemParser extends BaseItemParser {
    static ITEM_TYPE = "metamagic";

    constructor({ text, type, folderId }) {
        super({ text, type, folderId });
    }

    parse() {
        if (!this.ensureText()) return null;

        const lines = this.splitCleanLines();
        if (!lines.length) {
            return this.toFoundryItem({
                name: "Unnamed Metamagic",
                description: "",
                adepts: true,
                mages: true
            });
        }

        const rawName = lines[0];
        const remaining = lines.slice(1);

        const { name, qualifier } = this.parseNameLine(rawName);
        const audience = this.detectAudience(qualifier);

        const description = this.joinWrappedText(remaining);

        return this.toFoundryItem({
            name,
            description,
            adepts: audience.adepts,
            mages: audience.mages
        });
    }

    parseNameLine(line) {
        const text = String(line ?? "").trim();

        const match = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/u);
        if (!match) {
            return {
                name: text,
                qualifier: ""
            };
        }

        return {
            name: match[1].trim(),
            qualifier: match[2].trim()
        };
    }

    detectAudience(qualifier) {
        const q = String(qualifier ?? "").trim().toLowerCase();

        if (!q) {
            return { adepts: true, mages: true };
        }

        if (q.includes("adepts only") || q.includes("adept only")) {
            return { adepts: true, mages: false };
        }

        if (q.includes("mages only") || q.includes("mage only") || q.includes("magicians only") || q.includes("magician only")) {
            return { adepts: false, mages: true };
        }

        return { adepts: true, mages: true };
    }

    joinWrappedText(lines = []) {
        return lines
            .map((line) => String(line ?? "").trim())
            .filter((line) => line.length > 0)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    toFoundryItem({ name, description, adepts, mages }) {
        return {
            name: name || "Unnamed Metamagic",
            type: "metamagic",
            img: "systems/shadowrun6-eden/icons/compendium/default/daze.svg",
            system: {
                genesisID: "",
                description: description ?? "",
                product: "",
                page: 0,
                level: false,
                adepts: Boolean(adepts),
                mages: Boolean(mages)
            },
            effects: [],
            folder: this.folderId ?? null,
            flags: {}
        };
    }
}