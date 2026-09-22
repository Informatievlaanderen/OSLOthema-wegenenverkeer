"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Pure helper functions (no side effects)
// ---------------------------------------------------------------------------

/**
 * Read a directory and return sorted list of .ttl filenames (without extension),
 * excluding all.ttl.
 */
function getCurrentNames(sourceDirPath) {
  return fs
    .readdirSync(sourceDirPath)
    .filter((f) => f.endsWith(".ttl") && f !== "all.ttl")
    .map((f) => path.basename(f, ".ttl"))
    .sort();
}

/**
 * Determine which entries to add and remove from the dataset.
 * Returns { toAdd, toRemove, updatedOwned }.
 */
function computeDiff(currentNames, dataset, sourceRepo) {
  const ownsEntry = (entry) => entry.sourceUrl.includes(`/${sourceRepo}/`);

  const ownedEntries = dataset.conceptSchemes.filter(ownsEntry);
  const otherEntries = dataset.conceptSchemes.filter((e) => !ownsEntry(e));

  const ownedByRef = Object.fromEntries(ownedEntries.map((e) => [e.urlRef, e]));

  const currentSet = new Set(currentNames);
  const ownedSet = new Set(Object.keys(ownedByRef));

  const toAdd = currentNames.filter((n) => !ownedSet.has(n));
  const toRemove = [...ownedSet].filter((n) => !currentSet.has(n)).sort();

  const updatedOwned = currentNames.map(
    (name) =>
      ownedByRef[name] ?? {
        urlRef: name,
        sourceUrl: null, // filled in by caller
      },
  );

  return { toAdd, toRemove, updatedOwned, otherEntries };
}

/**
 * Apply the diff to the dataset and return the updated dataset object.
 */
function applyDiff(dataset, { toAdd, toRemove, updatedOwned, otherEntries }, sourceUrlBase) {
  if (toAdd.length === 0 && toRemove.length === 0) {
    return null; // no change
  }

  // Fill in sourceUrl for new entries
  for (const entry of updatedOwned) {
    if (!entry.sourceUrl) {
      entry.sourceUrl = `${sourceUrlBase}/${entry.urlRef}.ttl`;
    }
  }

  const result = { ...dataset };
  result.conceptSchemes = [...otherEntries, ...updatedOwned].sort((a, b) =>
    a.urlRef < b.urlRef ? -1 : a.urlRef > b.urlRef ? 1 : 0,
  );

  return result;
}

/**
 * Generate the content for all.ttl by concatenating all individual .ttl files.
 * Returns the complete Turtle content as a string.
 */
function generateAllTtlContent(sourceDirPath, currentNames) {
  const prefixSet = new Set();
  const bodyParts = [];

  for (const name of currentNames) {
    const filePath = path.join(sourceDirPath, `${name}.ttl`);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const bodyLines = [];

    for (const line of lines) {
      if (line.startsWith("@prefix ")) {
        prefixSet.add(line);
      } else {
        bodyLines.push(line);
      }
    }

    bodyParts.push(bodyLines.join("\n"));
  }

  const sortedPrefixes = [...prefixSet].sort();
  return sortedPrefixes.join("\n") + "\n\n" + bodyParts.join("\n");
}

// ---------------------------------------------------------------------------
// Side-effectful helpers (file I/O, zip)
// ---------------------------------------------------------------------------

/**
 * Write dataset.json to disk.
 */
function writeDataset(targetFilePath, dataset) {
  fs.writeFileSync(targetFilePath, JSON.stringify(dataset, null, 2) + "\n", "utf8");
}

/**
 * Write all.ttl to disk and create all.ttl.zip.
 */
function writeAllTtlAndZip(allTtlDirPath, content) {
  const allTtlPath = path.join(allTtlDirPath, "all.ttl");
  const allTtlZipPath = path.join(allTtlDirPath, "all.ttl.zip");

  fs.writeFileSync(allTtlPath, content, "utf8");
  console.log(`Written: ${allTtlPath}`);

  console.log("Generating all.ttl.zip...");
  execSync(`zip -j all.ttl.zip all.ttl`, { cwd: allTtlDirPath });
  console.log(`Written: ${allTtlZipPath}`);
}

module.exports = {
  getCurrentNames,
  computeDiff,
  applyDiff,
  generateAllTtlContent,
  writeDataset,
  writeAllTtlAndZip,
};