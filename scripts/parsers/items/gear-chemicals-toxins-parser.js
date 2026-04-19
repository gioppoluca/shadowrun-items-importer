import { BaseItemParser } from "./base-item-parser.js";

export class GearChemicalsToxinsParser extends BaseItemParser {
    static ITEM_TYPE = "gear.CHEMICALS.TOXINS";

    constructor({ text, type, folderId }) {
        super({ text, type, folderId });
    }

    parse() {
        if (!this.ensureText()) return null;

        const lines = this.splitCleanLines();
        if (!lines.length) {
            return this.toFoundryItem({
                name: "Unnamed Toxin",
                fields: {},
                description: ""
            });
        }

        const name = lines[0];
        const remaining = lines.slice(1);

        const fields = {};
        const descriptionLines = [];

        let inDescription = false;

        for (const rawLine of remaining) {
            const parsedField = !inDescription ? this.parseFieldLine(rawLine) : null;

            if (parsedField) {
                const label = this.normalizeLabel(parsedField.label);
                fields[label] = parsedField.value;
                continue;
            }

            const cleaned = this.stripBulletMarker(rawLine);
            if (!cleaned) continue;

            inDescription = true;
            descriptionLines.push(cleaned);
        }

        const description = this.buildDescription(fields, descriptionLines);

        return this.toFoundryItem({
            name,
            fields,
            description
        });
    }

    buildDescription(fields, descriptionLines) {
        const orderedLabels = ["vector", "speed", "duration", "power", "effect"];

        const fieldText = orderedLabels
            .filter((label) => fields[label])
            .map((label) => `<p><strong>${this.capitalizeLabel(label)}:</strong> ${fields[label]}</p>`)
            .join("");

        const bodyText = this.joinWrappedText(descriptionLines);

        if (fieldText && bodyText) {
            return `${fieldText}<p>${bodyText}</p>`;
        }

        if (fieldText) return fieldText;
        if (bodyText) return `<p>${bodyText}</p>`;
        return "";
    }

    joinWrappedText(lines = []) {
        return lines
            .map((line) => String(line ?? "").trim())
            .filter((line) => line.length > 0)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    capitalizeLabel(label) {
        return String(label ?? "")
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    isStunEffect(fields) {
        const effect = String(fields.effect ?? "").toLowerCase();
        return effect.includes("stun");
    }

    toFoundryItem({ name, fields, description }) {
        return {
            name: name || "Unnamed Toxin",
            type: "gear",
            img: "systems/shadowrun6-eden/icons/compendium/gear/tech_bag.svg",
            system: {
                genesisID: "",
                description: description ?? "",
                product: "",
                page: 0,
                modifier: 0,
                wild: false,
                pool: 0,
                type: "CHEMICALS",
                subtype: "TOXINS",
                count: 0,
                countable: false,
                availDef: "",
                avail: 0,
                ammocap: 0,
                ammocount: 0,
                ammoLoaded: "regular",
                priceDef: 0,
                price: 0,
                customName: "",
                usedForPool: false,
                notes: "",
                accessories: "",
                needsRating: false,
                rating: 0,
                skill: "",
                skillSpec: "",
                dmg: 0,
                stun: this.isStunEffect(fields),
                dmgDef: "",
                attackRating: [0, 0, 0, 0, 0],
                modes: {
                    BF: false,
                    FA: false,
                    SA: false,
                    SS: false
                },
                defense: 0,
                social: 0,
                essence: 0,
                capacity: 0,
                natural: false,
                devRating: 0,
                a: 0,
                s: 0,
                d: 0,
                f: 0,
                progSlots: 0,
                handlOn: 0,
                handlOff: 0,
                accOn: 0,
                accOff: 0,
                spdiOn: 0,
                spdiOff: 0,
                tspd: 0,
                bod: 0,
                arm: 0,
                pil: 0,
                sen: 0,
                sea: 0,
                vtype: "",
                vehicle: {
                    opMode: "manual"
                },
                strWeapon: false,
                dualHand: false
            },
            effects: [],
            folder: this.folderId ?? null,
            flags: {}
        };
    }
}