"use strict";

const fs = require("fs");
const path = require("path");
const { PACKAGE_MANIFEST_NAME } = require("../languageData");

function createPackageScaffold(targetDirectory, manifest, namespaceName, includeExample) {
    const libraryDirectory = path.join(targetDirectory, "Library");
    const examplesDirectory = path.join(targetDirectory, "Examples");
    fs.mkdirSync(libraryDirectory, { recursive: true });
    if (includeExample) {
        fs.mkdirSync(examplesDirectory, { recursive: true });
    }

    fs.writeFileSync(path.join(targetDirectory, PACKAGE_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(targetDirectory, "README.md"), buildPackageReadme(manifest, namespaceName), "utf8");
    fs.writeFileSync(path.join(targetDirectory, "LICENSE"), buildPackageLicense(manifest.author || "DreamShader Package Author"), "utf8");
    fs.writeFileSync(path.join(libraryDirectory, `${namespaceName}.dsh`), buildPackageEntryHeader(namespaceName), "utf8");

    if (includeExample) {
        fs.writeFileSync(
            path.join(examplesDirectory, `M_${namespaceName}Preview.dsm`),
            buildPackageExampleMaterial(manifest, namespaceName),
            "utf8");
    }
}

function buildPackageReadme(manifest, namespaceName) {
    return `# ${manifest.displayName || manifest.name}

${manifest.description || "Reusable DreamShaderLang functions."}

## Install

\`\`\`text
DreamShaderLang: Install Package from GitHub
${manifest.repository || manifest.name}
\`\`\`

## Import

\`\`\`c
import "${manifest.name}/${manifest.dreamshader.entry}";
\`\`\`

## Example

\`\`\`c
Graph = {
    float3 color = float3(1.0, 0.5, 0.25);
    float3 result;
    ${namespaceName}::Identity(color, result);
}
\`\`\`
`;
}

function buildPackageLicense(author) {
    return `MIT License

Copyright (c) 2026 ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function buildPackageEntryHeader(namespaceName) {
    return `Namespace(Name="${namespaceName}")
{
    Function Identity(in vec3 input, out vec3 result) {
        result = input;
    }

    Function Lerp(in vec3 a, in vec3 b, in float alpha, out vec3 result) {
        result = lerp(a, b, saturate(alpha));
    }
}
`;
}

function buildPackageExampleMaterial(manifest, namespaceName) {
    return `import "${manifest.name}/${manifest.dreamshader.entry}";

Shader(Name="DreamShaderExamples/M_${namespaceName}Preview")
{
    Properties = {
        vec3 InColor = vec3(1.0, 0.45, 0.2);
    }

    Settings = {
        Domain = "Surface";
        ShadingModel = "Unlit";
        BlendMode = "Opaque";
    }

    Outputs = {
        vec3 Res;
        Base.EmissiveColor = Res;
    }

    Graph = {
        ${namespaceName}::Identity(InColor, Res);
    }
}
`;
}

module.exports = {
    createPackageScaffold
};
