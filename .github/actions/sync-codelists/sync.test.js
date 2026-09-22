"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("node:assert");
const { describe, it, before } = require("node:test");

const {
  getCurrentNames,
  computeDiff,
  applyDiff,
  generateAllTtlContent,
  writeAllTtlAndZip,
} = require("./sync-lib");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory and return its path. */
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sync-test-"));
}

/** Output directory for generated all.ttl / all.ttl.zip (alongside this test file). */
const outputDir = path.join(__dirname, "test-output");

/** Remove a directory recursively. */
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Write a .ttl file. */
function writeTtl(dir, name, prefixes, body) {
  const lines = [...prefixes, "", ...body];
  fs.writeFileSync(path.join(dir, `${name}.ttl`), lines.join("\n"), "utf8");
}

const SAMPLE_PREFIXES = [
  "@prefix dct: <http://purl.org/dc/terms/> .",
  "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
  "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .",
  "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
];

const SCHEME_A = `<https://wegenenverkeer.data.vlaanderen.be/id/conceptscheme/KlAIMToestand> a skos:ConceptScheme;
  skos:prefLabel "AIM toestand"@nl.`;

const CONCEPT_A1 = `<https://wegenenverkeer.data.vlaanderen.be/id/concept/KlAIMToestand/verwijderd> a skos:Concept;
  skos:prefLabel "verwijderd"@nl;
  skos:inScheme <https://wegenenverkeer.data.vlaanderen.be/id/conceptscheme/KlAIMToestand>.`;

const SCHEME_B = `<https://wegenenverkeer.data.vlaanderen.be/id/conceptscheme/KlBordFabricageType> a skos:ConceptScheme;
  skos:prefLabel "Bord fabricage type"@nl.`;

const CONCEPT_B1 = `<https://wegenenverkeer.data.vlaanderen.be/id/concept/KlBordFabricageType/BRUGGEN_EN_WEGEN> a skos:Concept;
  skos:prefLabel "Bruggen en wegen"@nl;
  skos:inScheme <https://wegenenverkeer.data.vlaanderen.be/id/conceptscheme/KlBordFabricageType>.`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getCurrentNames", () => {
  it("returns sorted .ttl files excluding all.ttl", () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, "KlAIMToestand.ttl"), "", "utf8");
      fs.writeFileSync(path.join(dir, "KlBordFabricageType.ttl"), "", "utf8");
      fs.writeFileSync(path.join(dir, "all.ttl"), "", "utf8");
      fs.writeFileSync(path.join(dir, "readme.txt"), "", "utf8");

      const names = getCurrentNames(dir);
      assert.deepStrictEqual(names, ["KlAIMToestand", "KlBordFabricageType"]);
    } finally {
      rmDir(dir);
    }
  });

  it("returns empty array when no .ttl files exist", () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, "readme.txt"), "", "utf8");
      assert.deepStrictEqual(getCurrentNames(dir), []);
    } finally {
      rmDir(dir);
    }
  });

  it("returns empty array when directory is empty", () => {
    const dir = tmpDir();
    try {
      assert.deepStrictEqual(getCurrentNames(dir), []);
    } finally {
      rmDir(dir);
    }
  });
});

describe("computeDiff", () => {
  it("detects added entries", () => {
    const currentNames = ["KlAIMToestand", "KlBordFabricageType"];
    const dataset = {
      conceptSchemes: [
        {
          urlRef: "KlAIMToestand",
          sourceUrl:
            "https://raw.githubusercontent.com/foo/bar/KlAIMToestand.ttl",
        },
      ],
    };
    const result = computeDiff(currentNames, dataset, "foo/bar");
    assert.deepStrictEqual(result.toAdd, ["KlBordFabricageType"]);
    assert.deepStrictEqual(result.toRemove, []);
    assert.strictEqual(result.updatedOwned.length, 2);
    // existing entry is preserved
    assert.strictEqual(result.updatedOwned[0].urlRef, "KlAIMToestand");
    assert.strictEqual(
      result.updatedOwned[0].sourceUrl,
      "https://raw.githubusercontent.com/foo/bar/KlAIMToestand.ttl",
    );
    // new entry has no sourceUrl yet (filled by applyDiff)
    assert.strictEqual(result.updatedOwned[1].urlRef, "KlBordFabricageType");
    assert.strictEqual(result.updatedOwned[1].sourceUrl, null);
  });

  it("detects removed entries", () => {
    const currentNames = ["KlAIMToestand"];
    const dataset = {
      conceptSchemes: [
        {
          urlRef: "KlAIMToestand",
          sourceUrl:
            "https://raw.githubusercontent.com/foo/bar/KlAIMToestand.ttl",
        },
        {
          urlRef: "KlBordFabricageType",
          sourceUrl:
            "https://raw.githubusercontent.com/foo/bar/KlBordFabricageType.ttl",
        },
      ],
    };
    const result = computeDiff(currentNames, dataset, "foo/bar");
    assert.deepStrictEqual(result.toAdd, []);
    assert.deepStrictEqual(result.toRemove, ["KlBordFabricageType"]);
    assert.strictEqual(result.updatedOwned.length, 1);
  });

  it("ignores entries not owned by source repo", () => {
    const currentNames = ["KlAIMToestand"];
    const dataset = {
      conceptSchemes: [
        {
          urlRef: "KlAIMToestand",
          sourceUrl:
            "https://raw.githubusercontent.com/foo/bar/KlAIMToestand.ttl",
        },
        {
          urlRef: "ExternalEntry",
          sourceUrl:
            "https://raw.githubusercontent.com/other/repo/ExternalEntry.ttl",
        },
      ],
    };
    const result = computeDiff(currentNames, dataset, "foo/bar");
    // ExternalEntry stays in otherEntries
    assert.strictEqual(result.otherEntries.length, 1);
    assert.strictEqual(result.otherEntries[0].urlRef, "ExternalEntry");
    assert.deepStrictEqual(result.toAdd, []);
    assert.deepStrictEqual(result.toRemove, []);
  });

  it("returns empty diff when nothing changed", () => {
    const currentNames = ["KlAIMToestand"];
    const dataset = {
      conceptSchemes: [
        {
          urlRef: "KlAIMToestand",
          sourceUrl:
            "https://raw.githubusercontent.com/foo/bar/KlAIMToestand.ttl",
        },
      ],
    };
    const result = computeDiff(currentNames, dataset, "foo/bar");
    assert.deepStrictEqual(result.toAdd, []);
    assert.deepStrictEqual(result.toRemove, []);
  });
});

describe("applyDiff", () => {
  it("returns null when no changes", () => {
    const dataset = { conceptSchemes: [] };
    const diff = {
      toAdd: [],
      toRemove: [],
      updatedOwned: [],
      otherEntries: [],
    };
    assert.strictEqual(applyDiff(dataset, diff, "http://base"), null);
  });

  it("fills sourceUrl for new entries and sorts alphabetically", () => {
    const dataset = { conceptSchemes: [] };
    const diff = {
      toAdd: ["KlBordFabricageType"],
      toRemove: [],
      updatedOwned: [
        { urlRef: "KlAIMToestand", sourceUrl: "http://existing" },
        { urlRef: "KlBordFabricageType", sourceUrl: null },
      ],
      otherEntries: [],
    };
    const result = applyDiff(dataset, diff, "https://base");
    assert.ok(result);
    assert.strictEqual(result.conceptSchemes.length, 2);
    // KlAIMToestand comes first alphabetically
    assert.strictEqual(result.conceptSchemes[0].urlRef, "KlAIMToestand");
    assert.strictEqual(result.conceptSchemes[0].sourceUrl, "http://existing");
    assert.strictEqual(result.conceptSchemes[1].urlRef, "KlBordFabricageType");
    assert.strictEqual(
      result.conceptSchemes[1].sourceUrl,
      "https://base/KlBordFabricageType.ttl",
    );
  });

  it("preserves otherEntries and merges with updatedOwned", () => {
    const dataset = { conceptSchemes: [] };
    const diff = {
      toAdd: ["Owned"],
      toRemove: [],
      updatedOwned: [{ urlRef: "Owned", sourceUrl: null }],
      otherEntries: [{ urlRef: "External", sourceUrl: "http://external" }],
    };
    const result = applyDiff(dataset, diff, "http://base");
    assert.ok(result);
    assert.strictEqual(result.conceptSchemes.length, 2);
    assert.strictEqual(result.conceptSchemes[0].urlRef, "External");
    assert.strictEqual(result.conceptSchemes[1].urlRef, "Owned");
  });
});

describe("generateAllTtlContent", () => {
  before(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  it("concatenates multiple .ttl files with deduplicated prefixes", () => {
    const dir = tmpDir();
    try {
      writeTtl(dir, "KlAIMToestand", SAMPLE_PREFIXES, [
        SCHEME_A,
        "",
        CONCEPT_A1,
      ]);
      writeTtl(dir, "KlBordFabricageType", SAMPLE_PREFIXES, [
        SCHEME_B,
        "",
        CONCEPT_B1,
      ]);

      const content = generateAllTtlContent(dir, [
        "KlAIMToestand",
        "KlBordFabricageType",
      ]);

      writeAllTtlAndZip(outputDir, content);
      const writtenPath = path.join(outputDir, "all.ttl");
      const writtenZipPath = path.join(outputDir, "all.ttl.zip");
      assert.ok(fs.existsSync(writtenPath), "all.ttl should exist");
      assert.ok(fs.existsSync(writtenZipPath), "all.ttl.zip should exist");
      const written = fs.readFileSync(writtenPath, "utf8");
      assert.strictEqual(written, content);

      // Prefixes appear once, sorted
      assert.ok(content.startsWith("@prefix dct:"));
      assert.ok(content.includes("@prefix rdf:"));
      assert.ok(content.includes("@prefix skos:"));
      assert.ok(content.includes("@prefix xsd:"));

      // Only one @prefix block
      const prefixMatches = content.match(/@prefix /g);
      assert.strictEqual(prefixMatches.length, 4);

      // Body contains both schemes and concepts
      assert.ok(content.includes("KlAIMToestand"));
      assert.ok(content.includes("KlBordFabricageType"));
      assert.ok(content.includes("verwijderd"));
      assert.ok(content.includes("BRUGGEN_EN_WEGEN"));
    } finally {
      rmDir(dir);
    }
  });

  it("handles a single .ttl file", () => {
    const dir = tmpDir();
    try {
      writeTtl(dir, "KlAIMToestand", SAMPLE_PREFIXES, [
        SCHEME_A,
        "",
        CONCEPT_A1,
      ]);

      const content = generateAllTtlContent(dir, ["KlAIMToestand"]);

      writeAllTtlAndZip(outputDir, content);
      assert.ok(fs.existsSync(path.join(outputDir, "all.ttl")));
      assert.ok(fs.existsSync(path.join(outputDir, "all.ttl.zip")));

      assert.ok(content.includes("KlAIMToestand"));
      assert.ok(content.includes("verwijderd"));
      assert.ok(content.includes("@prefix skos:"));
    } finally {
      rmDir(dir);
    }
  });

  it("handles empty file list", () => {
    const dir = tmpDir();
    try {
      const content = generateAllTtlContent(dir, []);

      writeAllTtlAndZip(outputDir, content);
      assert.ok(fs.existsSync(path.join(outputDir, "all.ttl")));
      assert.ok(fs.existsSync(path.join(outputDir, "all.ttl.zip")));

      assert.strictEqual(content, "\n\n");
    } finally {
      rmDir(dir);
    }
  });

  it("handles files with no prefixes", () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, "KlAIMToestand.ttl"),
        `${SCHEME_A}\n\n${CONCEPT_A1}\n`,
        "utf8",
      );

      const content = generateAllTtlContent(dir, ["KlAIMToestand"]);

      writeAllTtlAndZip(outputDir, content);
      assert.ok(fs.existsSync(path.join(outputDir, "all.ttl")));
      assert.ok(fs.existsSync(path.join(outputDir, "all.ttl.zip")));

      // No prefix lines, just a blank line separator then body
      assert.strictEqual(content, "\n\n" + `${SCHEME_A}\n\n${CONCEPT_A1}\n`);
    } finally {
      rmDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration test: generate all.ttl from the real codelijsten directory
// ---------------------------------------------------------------------------

describe("generate all.ttl from real codelijsten", () => {
  const codelijstenDir = path.resolve(__dirname, "..", "..", "..", "codelijsten");

  before(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  it("generates all.ttl containing all real codelist files", () => {
    const names = getCurrentNames(codelijstenDir);
    assert.ok(names.length > 10, `expected many codelists, got ${names.length}`);

    const content = generateAllTtlContent(codelijstenDir, names);
    writeAllTtlAndZip(outputDir, content);

    const writtenPath = path.join(outputDir, "all.ttl");
    const writtenZipPath = path.join(outputDir, "all.ttl.zip");
    assert.ok(fs.existsSync(writtenPath), "all.ttl should exist");
    assert.ok(fs.existsSync(writtenZipPath), "all.ttl.zip should exist");

    // Verify it contains all expected scheme names
    for (const name of names) {
      assert.ok(
        content.includes(name),
        `all.ttl should contain concept scheme ${name}`,
      );
    }

    // Verify prefixes are present
    assert.ok(content.includes("@prefix skos:"));
    assert.ok(content.includes("@prefix dct:"));
    assert.ok(content.includes("@prefix rdf:"));
    assert.ok(content.includes("@prefix xsd:"));
  });
});
