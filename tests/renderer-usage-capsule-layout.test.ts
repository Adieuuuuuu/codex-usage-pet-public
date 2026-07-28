import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(
  new URL("../src/renderer/index.html", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

test("uses three direct information regions in the long usage capsule", () => {
  const capsule =
    html.match(
      /<button[^>]*id="usage-capsule"[\s\S]*?<\/button>/,
    )?.[0] ?? "";

  assert.match(capsule, /class="usage-primary"/);
  assert.match(capsule, /class="usage-number"/);
  assert.match(capsule, /<svg[^>]*id="remaining-progress"/);
  assert.match(capsule, /id="remaining-progress-value"/);
  assert.doesNotMatch(capsule, /<progress/);
  assert.equal(
    capsule.match(/class="usage-divider"/g)?.length,
    2,
  );
  assert.match(capsule, /class="usage-date"/);
  assert.match(capsule, /id="reset-date" class="reset-date"/);
  assert.match(capsule, /id="reset-month"/);
  assert.match(capsule, /id="reset-day"/);
  assert.match(capsule, /id="reset-weekday"/);
  assert.match(capsule, /class="usage-stats"/);
  assert.match(capsule, /usage-stat-icon-running/);
  assert.match(capsule, /usage-stat-icon-completed/);
  assert.doesNotMatch(capsule, />\s*个\s*</);
  assert.doesNotMatch(capsule, /class="usage-details"/);
});

test("keeps the three capsule regions equal and their contents separated", () => {
  assert.match(
    styles,
    /\.usage-capsule\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*1px\s*minmax\(0,\s*1fr\)\s*1px\s*minmax\(0,\s*1fr\);[^}]*align-items:\s*center/s,
  );
  assert.match(
    styles,
    /\.usage-primary\s*\{[^}]*place-items:\s*center;/s,
  );
  assert.match(
    styles,
    /\.usage-number\s*\{[^}]*font-size:\s*19px;/s,
  );
  assert.match(
    styles,
    /\.usage-ring-value\s*\{[^}]*stroke-dasharray:\s*100;[^}]*stroke-dashoffset:\s*100;/s,
  );
  assert.match(
    styles,
    /\.usage-divider\s*\{[^}]*height:\s*34px;[^}]*background:\s*color-mix\(/s,
  );
  assert.match(
    styles,
    /\.reset-date\s*\{[^}]*color:\s*var\(--usage-date\);/s,
  );
  assert.match(
    styles,
    /\.usage-stats\s*\{[^}]*justify-content:\s*center;[^}]*padding-left:\s*0;/s,
  );
  assert.match(
    styles,
    /\.usage-stat-value\s*\{[^}]*margin-left:\s*5px;/s,
  );
  assert.match(
    styles,
    /\.usage-stat-icon-running\s*\{[^}]*mask-image:\s*url\("\.\/icons\/circle-play\.svg"\);/s,
  );

  const capsuleRules =
    styles.match(/\.usage-capsule\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(capsuleRules, /height:\s*72px/);
  assert.match(capsuleRules, /border-radius:\s*999px/);
  assert.match(capsuleRules, /box-shadow:\s*none/);
  assert.match(capsuleRules, /background:\s*var\(--surface\)/);
  assert.match(capsuleRules, /border:\s*1px solid var\(--line\)/);
  assert.doesNotMatch(
    capsuleRules,
    /gradient|drop-shadow/,
  );
});

test("does not show a focus outline around the expanded capsule", () => {
  const focusRules =
    styles.match(/\.usage-capsule:focus-visible\s*\{[^}]*\}/s)?.[0] ??
    "";

  assert.match(focusRules, /outline:\s*none/);
  assert.doesNotMatch(focusRules, /var\(--blue\)|color-mix/);
});
