import { expect, test } from "@playwright/test";
import { CLIENT_ID_HEADER, isRatingResult, parseVersionResponse } from "../shared/src/contract";

const ORIGIN = "https://red-storm-prof-ratings.johnnycheck.workers.dev";

function item(key: string, name: string) {
  return { key, name, campus: "Queens Campus", subject: "Computer Science" };
}

test("GET /v1/version returns a cache version", async ({ request }) => {
  const response = await request.get(`${ORIGIN}/v1/version`);
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  const parsed = parseVersionResponse(JSON.parse(text) as unknown);
  expect(parsed?.cacheVersion).toBeGreaterThan(0);
});

test("GET /privacy is the policy page", async ({ page }) => {
  const response = await page.goto(`${ORIGIN}/privacy`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("text/html");
  const body = await page.locator("body").innerText();
  expect(body).toContain("Red Storm Professor Ratings");
  expect(body).toContain("instructor name, campus, and subject description");
  expect(body).toContain("random client id used only for rate limits");
  expect(body).toContain("7-day shared cache for rated");
  expect(body).toContain("24-hour shared cache for unrated");
  expect(body).toContain("24-hour browser cache for not_listed");
  expect(body).toContain("cacheVersion change drops local r* entries");
  expect(body).toContain("No student id, schedule, grades, cookies, or auth tokens are collected or sold.");
  expect(body).not.toMatch(/Bearer |rmpToken/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h2")).toHaveCount(4);
  await expect(page.locator("button, img")).toHaveCount(0);
  await expect(page.locator("header")).toHaveCSS("background-color", "rgb(20, 130, 128)");
  await expect(page.locator("h1")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator(".mark")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".mark")).toHaveCSS("width", "6px");
  await expect(page.locator(".mark")).toHaveCSS("height", "6px");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(34, 34, 34)");
  await expect(page.locator("body")).toHaveCSS("font-size", "16px");
  for (const heading of await page.locator("h2").all()) {
    await expect(heading).toHaveCSS("border-bottom-width", "2px");
    await expect(heading).toHaveCSS("border-bottom-color", "rgb(20, 130, 128)");
  }
  for (const width of [390, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("unknown paths are 404", async ({ request }) => {
  const response = await request.get(`${ORIGIN}/no-such-path`);
  expect(response.status()).toBe(404);
});

test("a ratings body that is not JSON is rejected", async ({ request }) => {
  const response = await request.post(`${ORIGIN}/v1/ratings`, {
    headers: { [CLIENT_ID_HEADER]: crypto.randomUUID(), "content-type": "text/plain" },
    data: "not-json",
  });
  expect(response.status()).toBe(400);
});

test("a missing client id is rejected and is not stored on a rating", async ({ request }) => {
  const response = await request.post(`${ORIGIN}/v1/ratings`, {
    data: { items: [item("probe", "Zzyzx Notapersonzz")] },
  });
  const text = await response.text();
  expect(response.status(), text).toBe(400);
  expect(text).toContain("X-Client-ID");
});

test("an empty batch and a Queens batch of 7 are rejected", async ({ request }) => {
  const client = crypto.randomUUID();
  const empty = await request.post(`${ORIGIN}/v1/ratings`, {
    headers: { [CLIENT_ID_HEADER]: client },
    data: { items: [] },
  });
  expect(empty.status()).toBe(400);
  const oversized = await request.post(`${ORIGIN}/v1/ratings`, {
    headers: { [CLIENT_ID_HEADER]: client },
    data: { items: Array.from({ length: 7 }, (_, index) => item(`row-${index}`, "Zzyzx Notapersonzz")) },
  });
  const text = await oversized.text();
  expect(oversized.status(), text).toBe(400);
  expect(text).toContain("At most 6");
});

test("TBA is absent from the ratings result", async ({ request }) => {
  const response = await request.post(`${ORIGIN}/v1/ratings`, {
    headers: { [CLIENT_ID_HEADER]: crypto.randomUUID() },
    data: { items: [item("tba", "TBA")] },
  });
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  const body = JSON.parse(text) as { results?: Record<string, unknown> };
  expect(body.results).toEqual({});
});

test("one unknown Queens name returns a rating result", async ({ request }) => {
  test.setTimeout(90_000);
  const clientId = crypto.randomUUID();
  const response = await request.post(`${ORIGIN}/v1/ratings`, {
    headers: { [CLIENT_ID_HEADER]: clientId },
    data: { items: [item("e2e-probe", "Zzyzx Qalph Notapersonzz")] },
  });
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  expect(text).not.toContain(clientId);
  const body = JSON.parse(text) as { cacheVersion?: unknown; results?: Record<string, unknown> };
  expect(typeof body.cacheVersion).toBe("number");
  const result = body.results?.["e2e-probe"];
  expect(isRatingResult(result), text).toBe(true);
});
