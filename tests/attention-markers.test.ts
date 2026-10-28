import assert from "node:assert/strict";
import { test } from "node:test";
import { getFieldPromptLayout } from "../src/attention-markers.ts";
import { loadFormMarkers } from "../backend/template.ts";

test("rectangular fill prompts sit inside the right end of their fields at every zoom", async () => {
  const fields = await loadFormMarkers();
  for (const pageWidth of [280, 400, 612, 918]) {
    const pageHeight = pageWidth * 792 / 612;
    for (const field of fields) {
      const prompt = getFieldPromptLayout(field, pageWidth, pageHeight);
      assert.ok(prompt.left >= field.left * pageWidth);
      assert.ok(prompt.left + prompt.width <= (field.left + field.width) * pageWidth);
      assert.ok(prompt.top >= field.top * pageHeight);
      assert.ok(prompt.top + prompt.height <= (field.top + field.height) * pageHeight);
      assert.ok(prompt.width > 0 && prompt.height > 0);
    }
  }
});
