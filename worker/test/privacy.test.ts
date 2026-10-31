import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { PRIVACY_PATH } from "../src/privacy";

const token = "rmp-token-must-not-appear";

describe("GET /privacy", () => {
  it("returns the policy as HTML and does not read KV or the rate limiter", async () => {
    let kvReads = 0;
    let limitChecks = 0;
    const response = await worker.fetch(
      new Request(`https://ratings.example${PRIVACY_PATH}`),
      {
        cacheVersion: 1,
        rmpToken: token,
        RATINGS: {
          async get() {
            kvReads += 1;
            return null;
          },
          async put() {
            throw new Error("kv put");
          },
        },
        RATE_LIMITS: {
          getByName: () => ({
            check: async () => {
              limitChecks += 1;
              return "ok" as const;
            },
          }),
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("instructor name, campus, and subject description");
    expect(body).toContain("random installation ID used only for rate limits");
    expect(body).toContain("shared cache for 7 days for rated profiles");
    expect(body).toContain("24 hours for unrated profiles");
    expect(body).toContain("not_listed names");
    expect(body).toContain(
      "If cacheVersion changes, local r* entries are dropped.",
    );
    expect(body).toContain(
      "No student id, schedule, grades, cookies, or auth tokens are collected or sold.",
    );
    expect(body).toContain("<h1>Red Storm Professor Ratings</h1>");
    expect(body).toContain(
      "header, footer { background: #148280; color: #ffffff; }",
    );
    expect(body).toContain("h1 {\n    margin: 0;\n    color: #ffffff;");
    expect(body).toMatch(/\.mark \{[^}]*width: 8px;[^}]*background: #ffffff/);
    expect(body).toContain("<footer>");
    expect(body).toContain('class="wrap band"');
    expect(body).toContain('<main class="wrap">');
    expect(body).toContain('<footer>\n<div class="wrap">');
    expect(body).toContain("max-width: 40rem");
    const header = body.slice(
      body.indexOf("<header>"),
      body.indexOf("</header>"),
    );
    expect(header).not.toContain("St. John");
    expect(body).toContain("background: #ffffff");
    expect(body).toContain("color: #222222");
    expect(body).toContain("font-family: Arial, sans-serif");
    expect(body).toContain("font-size: 16px");
    expect(body).toContain("border-bottom: 2px solid #148280");
    expect(body.match(/<h2>/g)).toHaveLength(4);
    expect(body).toContain(
      "Unofficial. Not affiliated with St. John's University",
    );
    expect(body).not.toContain(token);
    expect(kvReads).toBe(0);
    expect(limitChecks).toBe(0);
  });
});
