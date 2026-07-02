"use strict";

const { scan } = require("./scanner");
const { splitTopLevel } = require("./utils");

const COLOR_CONSTRUCTOR_NAMES = new Set(["float3", "float4", "vec3", "vec4"]);
const NUMERIC_LITERAL_PATTERN = /^-?(?:\d+\.\d+|\d+|\.\d+)[fF]?$/;

// Finds float3(...)/float4(...)/vec3(...)/vec4(...) call expressions whose arguments are all bare
// numeric literals (or exactly one, for the scalar-splat constructor) -- these are color literals
// VS Code's built-in DocumentColorProvider UI can show an inline swatch/picker for. Calls whose
// arguments are identifiers/expressions are skipped: there's no concrete color to show or safely
// rewrite. Comments and strings are skipped automatically since the scanner never tokenizes their
// contents as identifiers.
function getDocumentColorRanges(text) {
    const tokens = scan(text);
    const ranges = [];

    const isTrivia = (token) => token.type === "whitespace" || token.type === "comment";
    const nextSignificantIndex = (fromIndex) => {
        let index = fromIndex;
        while (index < tokens.length && isTrivia(tokens[index])) {
            index += 1;
        }
        return index;
    };

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token.type !== "identifier" || !COLOR_CONSTRUCTOR_NAMES.has(token.value)) {
            continue;
        }

        const openIndex = nextSignificantIndex(i + 1);
        const openToken = tokens[openIndex];
        if (!openToken || openToken.type !== "symbol" || openToken.value !== "(") {
            continue;
        }

        const closeToken = findMatchingParen(tokens, openIndex);
        if (!closeToken) {
            continue;
        }

        const componentCount = token.value.endsWith("4") ? 4 : 3;
        const argumentValues = parseNumericArguments(text, openToken.end, closeToken.start);
        if (!argumentValues || (argumentValues.length !== componentCount && argumentValues.length !== 1)) {
            continue;
        }

        const components = argumentValues.length === 1
            ? new Array(componentCount).fill(argumentValues[0])
            : argumentValues;
        ranges.push({
            startOffset: token.start,
            endOffset: closeToken.end,
            constructorName: token.value,
            componentCount,
            color: {
                red: clampUnit(components[0]),
                green: clampUnit(components[1]),
                blue: clampUnit(components[2]),
                alpha: componentCount === 4 ? clampUnit(components[3]) : 1
            }
        });
    }

    return ranges;
}

function findMatchingParen(tokens, openIndex) {
    let depth = 1;
    for (let index = openIndex + 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type !== "symbol") {
            continue;
        }
        if (token.value === "(") {
            depth += 1;
        } else if (token.value === ")") {
            depth -= 1;
            if (depth === 0) {
                return token;
            }
        }
    }
    return null;
}

function parseNumericArguments(text, openEnd, closeStart) {
    const segments = splitTopLevel(text.slice(openEnd, closeStart), openEnd, ",");
    if (segments.length === 0) {
        return null;
    }
    const values = [];
    for (const segment of segments) {
        if (!NUMERIC_LITERAL_PATTERN.test(segment.text)) {
            return null;
        }
        values.push(parseFloat(segment.text));
    }
    return values;
}

function clampUnit(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}

function formatColorComponent(value) {
    const rounded = Math.round(clampUnit(value) * 1000) / 1000;
    let text = rounded.toFixed(3).replace(/0+$/, "");
    if (text.endsWith(".")) {
        text += "0";
    }
    return text;
}

// Formats an edited vscode.Color back into DreamShaderLang source text, preserving the original
// constructor spelling (float3/float4 vs the vec3/vec4 GLSL alias) and dropping the alpha
// component for the 3-component constructors, which have no alpha channel to write.
function formatColorPresentation(constructorName, componentCount, color) {
    const components = componentCount === 4
        ? [color.red, color.green, color.blue, color.alpha]
        : [color.red, color.green, color.blue];
    return `${constructorName}(${components.map(formatColorComponent).join(", ")})`;
}

module.exports = {
    getDocumentColorRanges,
    formatColorPresentation
};
