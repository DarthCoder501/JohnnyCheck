import { expect, test } from "./extension-fixture";

const DISCLAIMER =
  "Unofficial. Not affiliated with St. John's University, Rate My Professors, or Ellucian.";

test("the popup is the white panel with one control", async ({
  page,
  extensionId,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator("h1")).toHaveText("Red Storm Professor Ratings");
  await expect(page.locator(".rspr-mark")).toHaveCount(1);
  await expect(page.locator(".rspr-mark")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator(".rspr-mark")).toHaveCSS("width", "8px");
  await expect(page.locator(".rspr-mark")).toHaveCSS("height", "8px");
  const transform = await page
    .locator(".rspr-mark")
    .evaluate((element) => getComputedStyle(element).transform);
  expect(transform).not.toBe("none");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator("body")).toHaveCSS("color", "rgb(34, 34, 34)");
  await expect(page.locator("body")).toHaveCSS("width", "360px");
  await expect(page.locator("body")).toHaveCSS("box-shadow", "none");
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
  await expect(page.locator("button, img")).toHaveCount(0);
  const label = page.locator("label.rspr-popup-toggle");
  await expect(label).toContainText("Show Ratings");
  const labelBox = await label.boundingBox();
  expect(labelBox?.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator("input[type='checkbox']")).toHaveCSS(
    "background-color",
    "rgb(20, 130, 128)",
  );
  const links = page.locator("a");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveText(["Privacy →"]);
  await expect(links).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(links).toHaveCSS("text-decoration-line", "none");
  const linkBox = await links.boundingBox();
  expect(linkBox?.height).toBeGreaterThanOrEqual(24);
  expect(errors).toEqual([]);
});

test("Show ratings stays off after a reload", async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const box = page.locator("#show-ratings");
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.reload();
  await expect(box).not.toBeChecked();
  await box.check();
});

test("forced colors keep the popup diamond visible", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.emulateMedia({ forcedColors: "active" });
  const mark = page.locator(".rspr-mark");
  await expect(mark).toBeVisible();
  await expect(mark).toHaveCSS("width", "8px");
  const fill = await mark.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(fill).not.toBe("rgba(0, 0, 0, 0)");
});
