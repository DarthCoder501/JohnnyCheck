import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCampus } from "../../shared/src/campus";
import {
  SCHOOL_IDS,
  SURNAME_PAGE_SIZE,
  schoolGraphqlId,
  toStoredRating,
  unavailableResult,
} from "../../shared/src/contract";
import { parseInstructor } from "../../shared/src/names";
import { resetSurnameIsolate, searchSurname } from "../src/rmp";

const TOKEN = "public-token";
const QUEENS = schoolGraphqlId(SCHOOL_IDS.queens);

afterEach(() => {
  resetSurnameIsolate();
  vi.useRealTimers();
});

function nameOf(raw: string) {
  const name = parseInstructor(raw);
  if (name === null) {
    throw new Error(`unparsed ${raw}`);
  }
  return name;
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    legacyId: 42,
    firstName: "Ann",
    lastName: "Smith",
    department: "Computer Science",
    numRatings: 28,
    avgRating: 4.5,
    avgDifficulty: 3.1,
    wouldTakeAgainPercent: 80,
    school: { name: "St. John's University - Jamaica/Queens", legacyId: SCHOOL_IDS.queens },
    ...overrides,
  };
}

function page(nodes: Record<string, unknown>[], hasNextPage: boolean, endCursor: string | null) {
  return new Response(
    JSON.stringify({
      data: {
        search: {
          teachers: {
            edges: nodes.map((item) => ({ node: item })),
            pageInfo: { hasNextPage, endCursor },
          },
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function callsOf(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    return {
      url: String(call[0]),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as {
        operationName: string;
        query: string;
        variables: {
          count: number;
          cursor: string;
          query: { text: string; schoolID: string; fallback: boolean };
        };
      },
    };
  });
}

function search(
  raw: string,
  fetchImpl: typeof fetch,
  schoolId = SCHOOL_IDS.queens,
  nowMs = 0,
) {
  return searchSurname({
    name: nameOf(raw),
    campus: resolveCampus("Queens"),
    subject: "Computer Science",
    schoolId,
    token: TOKEN,
    fetch: fetchImpl,
    nowMs,
  });
}

describe("surname search", () => {
  it("asks for one page of 100 and then one more page, even when page one already has the name", async () => {
    const fetchImpl = vi.fn(async () => page([node()], false, null));
    fetchImpl
      .mockResolvedValueOnce(page([node({ legacyId: 1 })], true, "cursor-2"))
      .mockResolvedValueOnce(page([node({ legacyId: 2, avgRating: 3.2, numRatings: 4 })], true, "cursor-3"));

    const result = await search("Ann Smith", fetchImpl);

    const calls = callsOf(fetchImpl);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://www.ratemyprofessors.com/graphql");
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]?.body.operationName).toBe("TeacherSearchPaginationQuery");
    expect(calls[0]?.body.query).toContain("first: $count");
    expect(calls[0]?.body.variables.count).toBe(SURNAME_PAGE_SIZE);
    expect(calls[0]?.body.variables.cursor).toBe("");
    expect(calls[0]?.body.variables.query).toEqual({
      text: "Smith",
      schoolID: QUEENS,
      fallback: true,
    });
    expect(calls[1]?.body.variables.cursor).toBe("cursor-2");
    expect(calls[1]?.body.variables.query.text).toBe("Smith");
    expect(result).toMatchObject({ status: "rated", match: "possible", legacyId: 1, reasons: ["same_name"] });
  });

  it("returns the page-two teacher when page one is other people with that surname", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        page([node({ legacyId: 7, firstName: "Robert", lastName: "Smith" })], true, "next"),
      )
      .mockResolvedValueOnce(page([node({ legacyId: 9 })], false, null));

    const result = await search("Ann Smith", fetchImpl);

    expect(callsOf(fetchImpl)).toHaveLength(2);
    expect(result).toMatchObject({ status: "rated", match: "exact", legacyId: 9, quality: 4.5, numRatings: 28 });
  });

  it("turns a still-truncated miss into unavailable and does not query the final token", async () => {
    const fetchImpl = vi.fn(async () => page([], true, "more"));

    const result = await search("Thanh Van Nguyen", fetchImpl);

    expect(callsOf(fetchImpl).map((call) => call.body.variables.query.text)).toEqual([
      "Van Nguyen",
      "Van Nguyen",
    ]);
    expect(result).toEqual(unavailableResult());
    expect(toStoredRating(result, 0)).toBeNull();
  });

  it("queries the final token only after the full family finished with no last-name hit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page([node({ legacyId: 3, firstName: "Ada", lastName: "Lee" })], false, null))
      .mockResolvedValueOnce(
        page([node({ legacyId: 11, firstName: "Thanh", lastName: "Nguyen", avgRating: 3.2, numRatings: 6 })], false, null),
      );

    const result = await search("Thanh Van Nguyen", fetchImpl);

    expect(callsOf(fetchImpl).map((call) => call.body.variables.query.text)).toEqual(["Van Nguyen", "Nguyen"]);
    expect(result).toMatchObject({
      status: "rated",
      match: "possible",
      reasons: ["surname_fallback"],
      legacyId: 11,
      quality: 3.2,
    });
  });

  it("does not query the final token when the full family already had a last-name hit", async () => {
    const fetchImpl = vi.fn(async () =>
      page([node({ legacyId: 4, firstName: "Mina", lastName: "Van Nguyen" })], false, null),
    );

    const result = await search("Thanh Van Nguyen", fetchImpl);

    expect(callsOf(fetchImpl).map((call) => call.body.variables.query.text)).toEqual(["Van Nguyen"]);
    expect(result).toMatchObject({ status: "not_listed" });
    expect(toStoredRating(result, 0)?.result).toMatchObject({ status: "not_listed" });
  });

  it("treats HTTP 403 and an HTML body as unavailable for five minutes", async () => {
    const forbidden = vi.fn(async () => new Response("no", { status: 403 }));
    const first = await search("Ann Smith", forbidden, SCHOOL_IDS.queens, 1_000);
    const during = await search("Robert Lee", forbidden, SCHOOL_IDS.queens, 1_000 + 60_000);
    expect(first).toEqual(unavailableResult());
    expect(toStoredRating(first, 1_000)).toBeNull();
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(during).toEqual(unavailableResult());

    resetSurnameIsolate();
    const html = vi.fn(
      async () => new Response("<html>challenge</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const blocked = await search("Ann Smith", html, SCHOOL_IDS.queens, 5_000);
    const still = await search("Ann Smith", html, SCHOOL_IDS.queens, 5_000 + 5 * 60 * 1000 - 1);
    const after = await search("Ann Smith", html, SCHOOL_IDS.queens, 5_000 + 5 * 60 * 1000);
    expect(blocked).toEqual(unavailableResult());
    expect(toStoredRating(blocked, 5_000)).toBeNull();
    expect(html).toHaveBeenCalledTimes(2);
    expect(still).toEqual(unavailableResult());
    expect(after).toMatchObject({ status: "unavailable" });
  });

  it("single-flights one surname at one school and keeps at most six upstream calls in flight", async () => {
    let inflight = 0;
    let maxInflight = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await gate;
      inflight -= 1;
      return page([node(), node({ legacyId: 8, firstName: "Jane", lastName: "Smith", avgRating: 2, numRatings: 3 })], false, null);
    });

    const shared = Promise.all([search("Ann Smith", fetchImpl), search("Jane Smith", fetchImpl)]);
    const others = ["Lee", "Chen", "Kim", "Patel", "Johnson", "Garcia"].map((family) =>
      search(`Ann ${family}`, fetchImpl),
    );
    await vi.waitUntil(() => maxInflight === 6);
    expect(inflight).toBe(6);
    release();
    const [ann, jane] = await shared;
    await Promise.all(others);

    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(ann).toMatchObject({ legacyId: 42, quality: 4.5 });
    expect(jane).toMatchObject({ legacyId: 8, quality: 2 });
  });

  it("treats a GraphQL body without data as unavailable without the five-minute block", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "nope" }] }), { status: 200 }))
      .mockResolvedValueOnce(page([node({ legacyId: 15 })], false, null));

    const missed = await search("Ann Smith", fetchImpl, SCHOOL_IDS.queens, 0);
    const next = await search("Ann Smith", fetchImpl, SCHOOL_IDS.queens, 1);

    expect(missed).toEqual(unavailableResult());
    expect(toStoredRating(missed, 0)).toBeNull();
    expect(next).toMatchObject({ legacyId: 15 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
