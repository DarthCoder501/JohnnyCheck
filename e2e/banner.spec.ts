import { expect, test } from "./extension-fixture";

const TERM = "https://reg-prod.stjohns.elluciancloud.com:8103/StudentRegistrationSsb/ssb/term/termSelection?mode=search";
const SEARCH = "https://reg-prod.stjohns.elluciancloud.com:8103/StudentRegistrationSsb/ssb/classSearch/classSearch";

test("the term picker loads and gets no chips", async ({ page }) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    const stack = error.stack ?? "";
    if (/content-script|popup|rspr/.test(`${error.message} ${stack}`)) errors.push(error.message);
  });
  const response = await page.goto(TERM, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveTitle(/Select a Term/);
  await expect(page.locator("#searchResultsParent")).toHaveCount(0);
  await expect(page.locator(".rspr-chip")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an unsigned class-search visit paints nothing", async ({ page }) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    const stack = error.stack ?? "";
    if (/content-script|popup|rspr/.test(`${error.message} ${stack}`)) errors.push(error.message);
  });
  await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("Registration");
  await expect(page).toHaveURL(/\/ssb\/registration\/registration$/);
  await expect(page.locator("#searchResultsParent")).toHaveCount(0);
  await expect(page.locator(".rspr-chip")).toHaveCount(0);
  expect(errors).toEqual([]);
});
