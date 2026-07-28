import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getTaskPanelLayout } from "../src/renderer/task-panel-layout.ts";

test("grows the task panel through ten visible tasks and scrolls from the eleventh", () => {
  assert.deepEqual(getTaskPanelLayout(1), {
    panelHeight: 110,
    taskListMaxHeight: 52,
    visibleTaskCount: 1,
  });
  assert.deepEqual(getTaskPanelLayout(2), {
    panelHeight: 169,
    taskListMaxHeight: 111,
    visibleTaskCount: 2,
  });
  assert.deepEqual(getTaskPanelLayout(10), {
    panelHeight: 641,
    taskListMaxHeight: 583,
    visibleTaskCount: 10,
  });
  assert.deepEqual(getTaskPanelLayout(11), {
    panelHeight: 641,
    taskListMaxHeight: 583,
    visibleTaskCount: 10,
  });
});

test("keeps an empty task panel at one compact slot", () => {
  assert.deepEqual(getTaskPanelLayout(0), {
    panelHeight: 110,
    taskListMaxHeight: 52,
    visibleTaskCount: 1,
  });
});

test("wires the calculated panel and list heights into scrollable renderer styles", () => {
  const rendererSource = readFileSync(
    new URL("../src/renderer/index.ts", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../src/renderer/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(rendererSource, /"--panel-height"/);
  assert.match(rendererSource, /"--task-list-max-height"/);
  assert.match(styles, /height:\s*var\(--panel-height\)/);
  assert.match(
    styles,
    /max-height:\s*var\(--task-list-max-height\)/,
  );
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(styles, /\.task-empty\s*\{[^}]*height:\s*52px/s);
});
