const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const primaryRule = styles.match(/\.paperlib-editor-actions > button\.mod-cta,[\s\S]*?\n\}/)?.[0] || "";
const secondaryRule = styles.match(/\.paperlib-editor-actions button:not\(\.mod-cta\),[\s\S]*?\n\}/)?.[0] || "";

assert.match(primaryRule, /\.paperlib-modal-buttons > button\.mod-cta/);
assert.match(primaryRule, /background:[\s\S]*linear-gradient[\s\S]*!important/);
assert.match(primaryRule, /color: #fff !important/);
assert.match(secondaryRule, /background: transparent/);
assert.doesNotMatch(styles, /\.paperlib-appearance-base-standard \.paperlib-icon-button\s*\{/);
assert.match(main, /DEFAULT_STANDARD_LIBRARY_COLUMNS = \["type", "title", "authors", "venue", "year", "notes"\]/);
assert.match(main, /standardTableColumns: \[\.\.\.DEFAULT_STANDARD_LIBRARY_COLUMNS\]/);
assert.match(main, /showStandardColumnMenu\(event\)/);
assert.match(main, /normalizeStandardTableColumns\(columns\)/);
assert.match(main, /"institution", "venue", "year", "rating"/);
assert.doesNotMatch(main, /standardCompact/);
assert.match(main, /paperlib-detail-toggle/);
assert.match(main, /paperlib-composer-toggle/);
assert.match(main, /data-paperlib-table-variant", "catalog"/);
assert.match(styles, /\.paperlib-appearance-standard\[data-paperlib-surface="library"\][\s\S]*data-paperlib-table-variant="catalog"/);
assert.doesNotMatch(styles, /paperlib-standard-density|is-standard-compact/);
assert.doesNotMatch(styles, /\.paperlib-appearance-standard\[data-paperlib-surface="library"\][^{]*\.paperlib-(?:sidebar|detail)/);

console.log("Paper Library primary button style tests passed.");
