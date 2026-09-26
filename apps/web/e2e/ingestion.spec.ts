import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { zipFixture } from "../test/zip-fixture.js";

const fixture = readFileSync(new URL("../test/fixtures/source-records.json", import.meta.url));
const longName = "source-" + "material".repeat(20) + ".json";

test("JSON selection, reset, same-file retry and malformed JSON stay local", async ({ page }) => {
  await page.goto("/import");
  // After app load, ingestion must work without any network request, including
  // lazy library downloads. Source bytes never leave the browser.
  const requests: string[] = [];
  await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  const input = page.getByLabel("Study material file");
  await input.setInputFiles({ name: longName, mimeType: "application/json", buffer: fixture });
  await expect(page.getByRole("heading", { name: "Ready for mapping" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("2 records discovered");
  await expect(page.getByRole("status")).toContainText("1 collection discovered");
  await expect(page.getByText(longName, { exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Choose another file" }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await input.setInputFiles({ name: longName, mimeType: "application/json", buffer: fixture });
  await expect(page.getByRole("heading", { name: "Ready for mapping" })).toBeVisible();
  await page.getByRole("button", { name: "Choose another file" }).click();
  await input.setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.getByRole("alert")).toHaveText("broken.json is not valid UTF-8 JSON.");
  await expect(page.getByRole("heading", { name: "Ready for mapping" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests).toEqual([]);
});

test("ZIP extraction discovers independent JSON sources without network processing", async ({ page }) => {
  const bytes = await zipFixture([["material/", ""], ["material/one.json", fixture.toString("utf8")], ["two.json", '[{"other":true}]'], ["notes.txt", "Ignored"]], true);
  await page.goto("/import");
  const requests: string[] = [];
  await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.getByLabel("Study material file").setInputFiles({ name: "material.zip", mimeType: "application/zip", buffer: Buffer.from(bytes) });
  await expect(page.getByRole("heading", { name: "Ready for mapping" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("2 JSON files found");
  await expect(page.getByRole("status")).toContainText("2 collections discovered");
  await expect(page.getByRole("status")).toContainText("3 records discovered");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests).toEqual([]);
});
