import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { privacyResponse } from "../src/privacy";

describe("privacy page column", () => {
  it("keeps the header, article, and footer copy in the same wrap", async () => {
    const html = await privacyResponse().text();
    const window = new Window();
    window.document.write(html);
    window.document.close();
    const doc = window.document;
    const header = doc.querySelector("header .wrap");
    const main = doc.querySelector("main.wrap");
    const footer = doc.querySelector("footer .wrap");
    expect(header).not.toBeNull();
    expect(main).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(header?.textContent).toContain("Red Storm Professor Ratings");
    expect(main?.textContent).toContain("Privacy Policy");
    expect(footer?.textContent).toContain("Unofficial");
    const style = doc.querySelector("style")?.textContent ?? "";
    expect(style).toMatch(
      /\.wrap \{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*max-width: 40rem;/,
    );
    expect(style).toContain("@media (min-width: 1024px)");
    expect(style).toContain(".wrap { max-width: 48rem; }");
    expect(style).toContain("min-height: 100%");
    expect(style).toContain("flex: 1 0 auto");
  });
});
