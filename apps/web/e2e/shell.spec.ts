import { expect, test, type Page } from "@playwright/test";

async function expectFocusedLayout(page: Page) {
  const layout = await page.locator(".app-shell").evaluate((shell) => {
    const bounds = shell.getBoundingClientRect();
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      left: bounds.left,
      right: window.innerWidth - bounds.right,
      width: bounds.width,
    };
  });
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.left).toBeGreaterThan(0);
  expect(Math.abs(layout.left - layout.right)).toBeLessThan(2);
  if (layout.viewportWidth >= 1000) {
    expect(layout.width).toBeLessThan(layout.viewportWidth * 0.8);
  }
}

test("Library → Import → Library works in a focused responsive canvas", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your study sets" })).toBeVisible();
  await expect(page.getByRole("region", { name: "No study sets yet" })).toBeVisible();
  await expect(page).toHaveTitle("Library | OpenStudy");
  await expectFocusedLayout(page);
  const action = page.getByRole("link", { name: "Import study set" });
  await expect(action).toBeInViewport();
  // Guard the production Tailwind pipeline, not just React's DOM output.
  await expect(page.locator("body")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(245, 246, 242)");
  await expect(action).toHaveCSS("background-color", "rgb(36, 93, 76)");
  await expect(action).toHaveCSS("border-radius", "10px");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-weight", "650");
  const bounds = await action.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("library.png"), fullPage: true });

  await action.click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page).toHaveTitle("Import | OpenStudy");
  await expect(page.getByRole("heading", { level: 1, name: "Import study material" })).toBeFocused();
  await expect(page.getByText(/Choose a JSON file or ZIP/)).toBeVisible();
  await expect(page.getByLabel("Study material file")).toHaveAttribute("accept", ".json,.zip");
  const pickerBounds = await page.getByLabel("Study material file").boundingBox();
  expect(pickerBounds!.height).toBeGreaterThanOrEqual(44);
  await expectFocusedLayout(page);
  await page.screenshot({ path: testInfo.outputPath("import.png"), fullPage: true });

  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your study sets" })).toBeFocused();
  await expectFocusedLayout(page);
  expect(errors).toEqual([]);
});

test("direct routes, reload, and browser history remain usable", async ({ page }) => {
  await page.goto("/import");
  await expect(page.getByRole("heading", { level: 1, name: "Import study material" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveTitle("Import | OpenStudy");
  await page.getByRole("link", { name: "Back to library" }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Import study material" })).toBeVisible();
  await page.goto("/unknown/page");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page).toHaveTitle("Page not found | OpenStudy");
  await expectFocusedLayout(page);
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page).toHaveURL("/");
});

test("keyboard flow exposes visible focus and announces destinations", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  const action = page.getByRole("link", { name: "Import study set" });
  await expect(action).toBeFocused();
  await expect(action).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Import study material" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Study material file")).toBeFocused();
  await expect(page.getByLabel("Study material file")).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Back to library" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Your study sets" })).toBeFocused();
});

test("200% text remains readable without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const expectNoOverflow = async () => {
    const size = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(size.content).toBeLessThanOrEqual(size.viewport);
  };
  await expectNoOverflow();
  await page.getByRole("link", { name: "Import study set" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Import study material" })).toBeVisible();
  await expectNoOverflow();
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your study sets" })).toBeVisible();
});
