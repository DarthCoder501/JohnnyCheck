import { createHash } from "node:crypto";
import { Window } from "happy-dom";
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
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'none'",
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "unsafe-inline",
    );
    const body = await response.text();
    expect(body).toContain("the instructor’s name, the campus, and the subject");
    expect(body).toContain("RateMyProfessors.com");
    expect(body).toContain("the instructor’s last name and your school");
    expect(body).toContain("stop any single install from sending too many requests");
    expect(body).toContain("The counters that use it reset within minutes.");
    expect(body).toContain("Professors who have a rating: saved for 7 days.");
    expect(body).toContain(
      "Professors with no rating or no listing: saved for 24 hours.",
    );
    expect(body).toContain("browser’s local extension storage");
    expect(body).toContain(
      "your browser’s saved ratings are cleared and refreshed automatically",
    );
    expect(body).toContain("Your student ID");
    expect(body).toContain("Login or authentication tokens");
    expect(body).toContain("We never sell your data.");
    expect(body).toContain(
      "follows the Chrome Web Store User Data Policy, including its Limited Use requirements.",
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
    expect(body.match(/<h2>/g)).toHaveLength(5);
    expect(body).toContain(
      "Unofficial. Not affiliated with St. John's University",
    );
    expect(body).not.toContain(token);
    const view = new Window();
    view.document.write(body);
    view.document.close();
    const css = view.document.querySelector("style")?.textContent ?? "";
    const hash = createHash("sha256").update(css).digest("base64");
    expect(response.headers.get("content-security-policy")).toContain(
      `style-src 'sha256-${hash}'`,
    );
    expect(kvReads).toBe(0);
    expect(limitChecks).toBe(0);
  });
});
