import { describe, expect, it } from "vitest";
import { chunkRequestItems, parseRatingsRequest, batchSizeFor } from "../src/batch";
import { ownCampusSchools, primarySchoolKey, resolveCampus } from "../src/campus";
import {
  SCHOOL_IDS,
  TTL_RATED_SECONDS,
  TTL_SHORT_SECONDS,
  isCacheable,
  isRatingResult,
  notListedResult,
  parseRatingsResponse,
  schoolGraphqlId,
  toStoredRating,
  unavailableResult,
  type RatingResult,
} from "../src/contract";
import { isRatingKey, localCacheKey, subjectKey } from "../src/keys";
import { instructorTextsFromCell, parseInstructor, splitInstructorText } from "../src/names";
import { areNicknames } from "../src/nicknames";
import { cleanText, nameKey } from "../src/normalize";
import { isPlaceholder } from "../src/placeholders";
import { compareSubject, normalizeSubject, subjectTokens } from "../src/subject";

function rated(overrides: Record<string, unknown> = {}) {
  return {
    status: "rated",
    match: "exact",
    reasons: ["initial"],
    legacyId: 42,
    rmpName: "Joan E. DeBello",
    department: "Computer Science",
    schoolName: "St. John's University - Jamaica/Queens",
    numRatings: 28,
    quality: 4.5,
    difficulty: 3.1,
    wouldTakeAgain: 80,
    ttlSeconds: TTL_RATED_SECONDS,
    ...overrides,
  };
}

function unrated(overrides: Record<string, unknown> = {}) {
  return {
    status: "unrated",
    match: "exact",
    reasons: [] as string[],
    legacyId: 77,
    rmpName: "Ronald Dixon",
    department: "Computer Information Systems",
    schoolName: "St. John's University - Jamaica/Queens",
    numRatings: 0,
    quality: null,
    difficulty: null,
    wouldTakeAgain: null,
    ttlSeconds: TTL_SHORT_SECONDS,
    ...overrides,
  };
}

describe("instructor names from the Banner capture", () => {
  it("parses western names, a period-less middle initial, and dotted suffixes", () => {
    expect(parseInstructor("Geoffrey Norman Dick (Primary)")).toMatchObject({
      given: "Geoffrey",
      middles: ["Norman"],
      family: "Dick",
    });
    expect(parseInstructor("Christina L Schweikert (Primary)")).toMatchObject({
      given: "Christina",
      middles: ["L"],
      middleKeys: ["l"],
      family: "Schweikert",
    });
    expect(parseInstructor("Christina L. Schweikert")).toMatchObject({ middleKeys: ["l"] });
    expect(parseInstructor("Puya Ghazizadeh Ph.D.")).toMatchObject({
      given: "Puya",
      middles: [],
      family: "Ghazizadeh",
    });
    expect(parseInstructor("Puya Ghazizadeh Ph. D.")).toMatchObject({ family: "Ghazizadeh" });
    expect(parseInstructor("Christopher P. Vogt Ph.D.")).toMatchObject({
      given: "Christopher",
      middles: ["P."],
      family: "Vogt",
    });
    expect(parseInstructor("Patrick S. Flanagan C.M.")).toMatchObject({
      given: "Patrick",
      middles: ["S."],
      family: "Flanagan",
    });
    expect(parseInstructor("Patrick S. Flanagan C.M. (Primary)")).toMatchObject({
      family: "Flanagan",
    });
  });

  it("strips other trailing dotted religious and degree suffixes instead of searching them as surnames", () => {
    expect(parseInstructor("Thomas Aquinas O.P.")).toMatchObject({
      given: "Thomas",
      family: "Aquinas",
    });
    expect(parseInstructor("Patrick S. Flanagan O.F.M.")).toMatchObject({
      given: "Patrick",
      middles: ["S."],
      family: "Flanagan",
    });
    expect(parseInstructor("Jane Smith R.Ph.")).toMatchObject({ given: "Jane", family: "Smith" });
    expect(parseInstructor("Jane Smith D.Min.")).toMatchObject({ family: "Smith" });
    expect(parseInstructor("Jane Smith Pharm.D.")).toMatchObject({ family: "Smith" });
    expect(parseInstructor("John Smith M.D.")).toMatchObject({ family: "Smith" });
    expect(parseInstructor("John Smith, Jr.")).toMatchObject({ given: "John", family: "Smith" });
    expect(parseInstructor("John A. Smith, Jr. (Primary)")).toMatchObject({
      given: "John",
      middles: ["A."],
      family: "Smith",
    });
  });

  it("keeps a one-letter middle and does not treat St. as a suffix", () => {
    expect(parseInstructor("Christopher P. Vogt")).toMatchObject({
      middles: ["P."],
      family: "Vogt",
    });
    expect(parseInstructor("John St. James")).toMatchObject({
      given: "John",
      family: "St. James",
      familyKey: "stjames",
    });
  });

  it("decodes Banner's double-escaped apostrophes before the surname is keyed", () => {
    expect(cleanText("O&#39;Connor")).toBe("O'Connor");
    expect(cleanText("O&amp;apos;Connor")).toBe("O'Connor");
    expect(cleanText("O&amp;#39;Connor")).toBe("O'Connor");
    expect(cleanText("DATA SECURITY &amp; CRYPTOGRAPHY")).toBe("DATA SECURITY & CRYPTOGRAPHY");
    expect(cleanText("ST. JOHN&#39;S UNIVERSITY")).toBe("ST. JOHN'S UNIVERSITY");
    expect(parseInstructor("Sean O&#39;Connor")).toMatchObject({
      family: "O'Connor",
      familyKey: "oconnor",
      familyFinalKey: "oconnor",
    });
    expect(parseInstructor("Sean O&amp;apos;Connor")?.familyKey).toBe("oconnor");
    expect(nameKey("José García")).toBe(nameKey("Jose Garcia"));
    expect(nameKey("Jørgensen")).toBe("jorgensen");
    expect(nameKey("Łukasz")).toBe("lukasz");
    expect(nameKey("Groß")).toBe("gross");
  });

  it("absorbs particles without eating the given name", () => {
    expect(parseInstructor("Di Chen")).toMatchObject({
      given: "Di",
      givenKey: "di",
      middles: [],
      family: "Chen",
      familyKey: "chen",
    });
    expect(parseInstructor("San Lee")).toMatchObject({ given: "San", family: "Lee" });
    expect(parseInstructor("Maria De La Cruz")).toMatchObject({
      given: "Maria",
      middles: [],
      family: "De La Cruz",
      familyKey: "delacruz",
      familyFinal: "Cruz",
      familyFinalKey: "cruz",
    });
    expect(parseInstructor("Thanh Van Nguyen")).toMatchObject({
      given: "Thanh",
      family: "Van Nguyen",
      familyKey: "vannguyen",
      familyFinal: "Nguyen",
      familyFinalKey: "nguyen",
    });
    expect(parseInstructor("De La Cruz")).toMatchObject({ given: "De", family: "Cruz" });
    expect(parseInstructor("Maria De Los Santos")).toMatchObject({ family: "De Los Santos" });
    expect(parseInstructor("Van Nguyen, Thanh")).toMatchObject({
      given: "Thanh",
      family: "Van Nguyen",
    });
    expect(parseInstructor("Smith, John A.")).toMatchObject({
      given: "John",
      middles: ["A."],
      family: "Smith",
    });
  });

  it("does not treat Ma as a degree unless it is dotted or follows a real comma suffix", () => {
    expect(parseInstructor("John Ma")).toMatchObject({ given: "John", family: "Ma" });
    expect(parseInstructor("Smith, Ma")).toMatchObject({ given: "Ma", family: "Smith" });
    expect(parseInstructor("John Smith, MA")).toMatchObject({
      given: "John",
      middles: [],
      family: "Smith",
    });
  });

  it("splits co-teachers on a parenthetical boundary or a line break, never on a comma", () => {
    expect(splitInstructorText("John A. Smith, Jr. (Primary)")).toEqual([
      "John A. Smith, Jr. (Primary)",
    ]);
    expect(splitInstructorText("John Smith, Jane Doe")).toEqual(["John Smith, Jane Doe"]);
    expect(splitInstructorText("John (Jack) Smith")).toEqual(["John (Jack) Smith"]);
    expect(splitInstructorText("Mary Ann (Annie) Smith")).toEqual(["Mary Ann (Annie) Smith"]);
    expect(splitInstructorText("John Smith (Primary) Jane Doe")).toEqual([
      "John Smith (Primary)",
      "Jane Doe",
    ]);
    expect(splitInstructorText("John Smith (Primary) Jane Doe (Primary)")).toEqual([
      "John Smith (Primary)",
      "Jane Doe (Primary)",
    ]);
    expect(splitInstructorText("Jane Doe\nChristina L Schweikert")).toEqual([
      "Jane Doe",
      "Christina L Schweikert",
    ]);
    expect(splitInstructorText("Jane Doe\nJohn Smith (Primary)\nChristina L Schweikert")).toEqual([
      "Jane Doe",
      "John Smith (Primary)",
      "Christina L Schweikert",
    ]);
  });

  it("reads each instructor link and leaves the primary marker and other anchors out", () => {
    const coTaught = {
      nodeType: 1,
      nodeName: "TD",
      textContent: "Jane Doe Geoffrey Norman Dick (Primary)Christina L Schweikert ",
      childNodes: [
        {
          nodeType: 1,
          nodeName: "A",
          className: "section-details-link",
          textContent: "SOFTWARE APPLICATION",
        },
        {
          nodeType: 1,
          nodeName: "A",
          className: "email instructor-contact-link",
          textContent: "Jane Doe",
        },
        { nodeType: 3, nodeName: "#text", textContent: " " },
        { nodeType: 1, nodeName: "BR", textContent: "" },
        {
          nodeType: 1,
          nodeName: "A",
          className: "email instructor-contact-link",
          textContent: "Geoffrey Norman Dick",
        },
        { nodeType: 3, nodeName: "#text", textContent: " (Primary)" },
        { nodeType: 1, nodeName: "BR", textContent: "" },
        {
          nodeType: 1,
          nodeName: "A",
          className: "email instructor-contact-link",
          textContent: "Christina L Schweikert",
        },
        { nodeType: 3, nodeName: "#text", textContent: " " },
        { nodeType: 1, nodeName: "BR", textContent: "" },
      ],
    };
    expect(instructorTextsFromCell(coTaught)).toEqual([
      "Jane Doe",
      "Geoffrey Norman Dick",
      "Christina L Schweikert",
    ]);
    expect(instructorTextsFromCell(coTaught).map((name) => parseInstructor(name)?.family)).toEqual([
      "Doe",
      "Dick",
      "Schweikert",
    ]);

    expect(
      instructorTextsFromCell({
        nodeType: 1,
        nodeName: "TD",
        textContent: "Sean O&#39;Connor (Primary)",
        childNodes: [
          {
            nodeType: 1,
            nodeName: "A",
            className: "email instructor-contact-link",
            textContent: "Sean O&#39;Connor",
          },
          { nodeType: 3, nodeName: "#text", textContent: " (Primary)" },
          { nodeType: 1, nodeName: "BR", textContent: "" },
        ],
      }).map((name) => parseInstructor(name)?.familyKey),
    ).toEqual(["oconnor"]);

    expect(
      instructorTextsFromCell({
        nodeType: 1,
        nodeName: "TD",
        textContent: "",
        childNodes: [],
      }),
    ).toEqual([]);
    expect(
      instructorTextsFromCell({
        nodeType: 1,
        nodeName: "TD",
        textContent: "TBA",
        childNodes: [{ nodeType: 3, nodeName: "#text", textContent: "TBA" }],
      }),
    ).toEqual([]);
    expect(
      instructorTextsFromCell({
        nodeType: 1,
        nodeName: "TD",
        textContent: "Joan E. DeBello",
        childNodes: [{ nodeType: 3, nodeName: "#text", textContent: "Joan E. DeBello" }],
      }),
    ).toEqual(["Joan E. DeBello"]);
  });

  it("does not query empty cells or placeholders", () => {
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder(null)).toBe(true);
    expect(isPlaceholder("   ")).toBe(true);
    expect(isPlaceholder("---")).toBe(true);
    expect(isPlaceholder("—")).toBe(true);
    expect(isPlaceholder("TBA")).toBe(true);
    expect(isPlaceholder("TBA (Primary)")).toBe(true);
    expect(isPlaceholder("Staff")).toBe(true);
    expect(isPlaceholder("Faculty")).toBe(true);
    expect(isPlaceholder("To Be Announced")).toBe(true);
    expect(isPlaceholder("N/A")).toBe(true);
    expect(isPlaceholder("Geoffrey Norman Dick")).toBe(false);
    expect(parseInstructor("")).toBeNull();
    expect(parseInstructor("TBA")).toBeNull();
    expect(parseInstructor("Staff")).toBeNull();
  });
});

describe("nickname map", () => {
  it("matches diminutives and does not treat shared short forms as transitive", () => {
    expect(areNicknames("bob", "robert")).toBe(true);
    expect(areNicknames("robert", "robert")).toBe(false);
    expect(areNicknames("geoffrey", "geoff")).toBe(true);
    expect(areNicknames("geoffrey", "jeffrey")).toBe(true);
    expect(areNicknames("chris", "christopher")).toBe(true);
    expect(areNicknames("chris", "christina")).toBe(true);
    expect(areNicknames("christopher", "christina")).toBe(false);
    expect(areNicknames("patrick", "pat")).toBe(true);
    expect(areNicknames("pat", "patricia")).toBe(true);
    expect(areNicknames("patrick", "patricia")).toBe(false);
    expect(areNicknames("john", "jonathan")).toBe(false);
    expect(areNicknames("al", "albert")).toBe(true);
    expect(areNicknames("al", "alfred")).toBe(true);
    expect(areNicknames("albert", "alfred")).toBe(false);
  });
});

describe("campus and cache keys", () => {
  it("trims the Queens campus cell and treats Online Learning as unknown", () => {
    const queens = resolveCampus(" Queens Campus");
    expect(queens.known).toBe(true);
    expect(queens.schools).toEqual([SCHOOL_IDS.queens, SCHOOL_IDS.generic]);
    expect(primarySchoolKey(queens)).toBe("842");

    const online = resolveCampus("Online Learning");
    expect(online.known).toBe(false);
    expect(online.schools).toEqual([
      SCHOOL_IDS.queens,
      SCHOOL_IDS.statenIsland,
      SCHOOL_IDS.manhattan,
      SCHOOL_IDS.generic,
    ]);
    expect(primarySchoolKey(online)).toBe("_");

    const staten = resolveCampus("Staten Island");
    expect(staten.schools[0]).toBe(SCHOOL_IDS.statenIsland);
    expect(ownCampusSchools(staten)).toEqual([SCHOOL_IDS.statenIsland, SCHOOL_IDS.generic]);
    expect(ownCampusSchools(staten)).not.toContain(SCHOOL_IDS.queens);
  });

  it("keys ratings by campus, subject, family, given name, and middle", () => {
    const joanE = parseInstructor("Joan E. DeBello");
    const joanL = parseInstructor("Joan L. DeBello");
    const joan = parseInstructor("Joan DeBello");
    expect(joanE && joanL && joan).toBeTruthy();
    if (!joanE || !joanL || !joan) {
      return;
    }

    expect(localCacheKey(1, " Queens Campus", "COMPUTER SCIENCE - CCPS", joanE)).toBe(
      "r1:842:computer-science:debello:joan:e",
    );
    expect(localCacheKey(1, " Queens Campus", "COMPUTER SCIENCE - SJC", joanE)).toBe(
      "r1:842:computer-science:debello:joan:e",
    );
    expect(localCacheKey(1, " Queens Campus", "COMPUTER SCIENCE - CCPS", joanL)).toBe(
      "r1:842:computer-science:debello:joan:l",
    );
    expect(localCacheKey(1, " Queens Campus", "COMPUTER SCIENCE - CCPS", joan)).toBe(
      "r1:842:computer-science:debello:joan:_",
    );
    expect(localCacheKey(1, " Queens Campus", "HISTORY", joanE)).toBe("r1:842:history:debello:joan:e");
    expect(localCacheKey(1, " Queens Campus", "ACCOUNTING - TOBIN", joanE)).toBe(
      "r1:842:accounting:debello:joan:e",
    );
    expect(localCacheKey(1, " Queens Campus", null, joan)).toBe("r1:842:_:debello:joan:_");
    expect(localCacheKey(1, "Online Learning", "THEOLOGY", parseInstructor("Patrick S. Flanagan C.M.")!)).toBe(
      "r1:_:theology:flanagan:patrick:s",
    );

    const thanh = parseInstructor("Thanh Van Nguyen");
    expect(thanh && localCacheKey(1, " Queens Campus", "HISTORY", thanh)).toBe(
      "r1:842:history:vannguyen:thanh:_",
    );

    const christina = parseInstructor("Christina L Schweikert");
    const christinaDot = parseInstructor("Christina L. Schweikert");
    expect(christina && christinaDot).toBeTruthy();
    if (christina && christinaDot) {
      expect(localCacheKey(1, " Queens Campus", "COMPUTER SCIENCE - CCPS", christina)).toBe(
        localCacheKey(1, " Queens Campus", "COMPUTER SCIENCE - CCPS", christinaDot),
      );
    }

    expect(isRatingKey("r1:842:computer-science:debello:joan:e")).toBe(true);
    expect(isRatingKey("meta:clientId")).toBe(false);
  });
});

describe("subject tie-break", () => {
  it("drops a trailing college code, including a six-letter program code", () => {
    expect(normalizeSubject("COMPUTER SCIENCE - CCPS")).toBe("computer science");
    expect(normalizeSubject("COMPUTER SCIENCE - SJC")).toBe("computer science");
    expect(subjectKey("COMPUTER SCIENCE - CCPS")).toBe("computer-science");
    expect(subjectKey("COMPUTER SCIENCE - SJC")).toBe("computer-science");
    expect(normalizeSubject("THEOLOGY")).toBe("theology");
    expect(normalizeSubject("CLINICAL PHARMACY PRACTICE")).toBe("clinical pharmacy practice");
    expect(normalizeSubject("PHARMACY - PHARMD")).toBe("pharmacy");
    expect(subjectTokens("PHARMACY - PHARMD")).toEqual(["pharmacy"]);
    expect(subjectTokens("CLINICAL PHARMACY PRACTICE")).toEqual(["clinical", "pharmacy", "practice"]);
    expect(subjectTokens("COMPUTER SCIENCE - CCPS")).toEqual(["computer"]);
    expect(normalizeSubject("ACCOUNTING - TOBIN")).toBe("accounting");
    expect(subjectKey(null)).toBe("_");
  });

  it("uses token overlap for unrelated departments and does not stem one department into another", () => {
    expect(compareSubject("COMPUTER SCIENCE - CCPS", "Computer Science").agreement).toBe("match");
    expect(compareSubject("COMPUTER SCIENCE - CCPS", "Computer Information Systems").agreement).toBe("match");
    expect(compareSubject("COMPUTER SCIENCE - CCPS", "History").agreement).toBe("conflict");
    expect(compareSubject("COMPUTER SCIENCE - CCPS", "Political Science").agreement).toBe("conflict");
    expect(compareSubject("COMPUTER SCIENCE - SJC", "Accounting").agreement).toBe("conflict");
    expect(compareSubject("THEOLOGY", "Theology").agreement).toBe("match");
    expect(compareSubject("THEOLOGY", "History").agreement).toBe("conflict");
    expect(compareSubject("ACCOUNTING - TOBIN", "Accounting").agreement).toBe("match");
    expect(compareSubject("ACCOUNTING - TOBIN", "ACCT").agreement).toBe("match");
    expect(compareSubject("ACCOUNTING - TOBIN", "History").agreement).toBe("conflict");
    expect(compareSubject("HISTORY", "HIST").agreement).toBe("match");
    expect(compareSubject("MATHEMATICS", "Math").agreement).toBe("match");
    expect(compareSubject("LAW", "Law").agreement).toBe("match");
    expect(compareSubject("CLINICAL PHARMACY PRACTICE", "Pharmacy").agreement).toBe("match");
    expect(compareSubject("PHARMACY - PHARMD", "Pharmacy").agreement).toBe("match");
    expect(compareSubject("PHARMACY - PHARMD", "Pharmacology").agreement).toBe("conflict");
    expect(compareSubject("PHARMACY - PHARMD", "Pharmaceutical Sciences").agreement).toBe("conflict");
    expect(compareSubject("PHYSICS", "Physics").agreement).toBe("match");
    expect(compareSubject("PHYSICS", "Physical Education").agreement).toBe("conflict");

    const clinical = compareSubject("CLINICAL PHARMACY PRACTICE", "Clinical Pharmacy");
    const pharmacy = compareSubject("CLINICAL PHARMACY PRACTICE", "Pharmacy");
    expect(clinical.agreement).toBe("match");
    expect(pharmacy.agreement).toBe("match");
    expect(clinical.overlap).toBeGreaterThan(pharmacy.overlap);

    expect(compareSubject(null, "Theology")).toEqual({ agreement: "unknown", overlap: 0 });
    expect(compareSubject("COMPUTER SCIENCE - CCPS", "Arts & Sciences").agreement).toBe("unknown");
    expect(compareSubject("THEOLOGY", "Business").agreement).toBe("unknown");
  });
});

describe("rating contract", () => {
  it("keeps a zero-rating profile distinct from not listed, and refuses a score with no ratings", () => {
    const shell = unrated();
    const scored = rated();
    expect(isRatingResult(shell)).toBe(true);
    expect(isRatingResult(scored)).toBe(true);
    expect(isRatingResult(notListedResult())).toBe(true);
    expect(notListedResult()).toEqual({ status: "not_listed", ttlSeconds: TTL_SHORT_SECONDS });
    expect(isRatingResult(unavailableResult())).toBe(true);

    expect(isRatingResult(rated({ numRatings: 0, quality: 0 }))).toBe(false);
    expect(isRatingResult(rated({ numRatings: 0, quality: 4.5 }))).toBe(false);
    expect(isRatingResult(unrated({ numRatings: 5 }))).toBe(false);

    expect(isRatingResult(rated({ match: "exact", reasons: ["surname_fallback"] }))).toBe(false);
    expect(isRatingResult(rated({ match: "possible", reasons: ["surname_fallback"] }))).toBe(true);
    expect(isRatingResult(rated({ match: "exact", reasons: ["nickname"] }))).toBe(false);
    expect(isRatingResult(rated({ match: "possible", reasons: ["nickname"] }))).toBe(true);
    expect(isRatingResult(rated({ match: "exact", reasons: ["middle_conflict"] }))).toBe(false);
    expect(isRatingResult(rated({ match: "exact", reasons: ["department_conflict"] }))).toBe(false);
    expect(isRatingResult(rated({ match: "exact", reasons: ["unknown_campus"] }))).toBe(false);
    expect(isRatingResult(rated({ match: "exact", reasons: ["initial"] }))).toBe(true);

    expect(isCacheable(unavailableResult())).toBe(false);
    expect(toStoredRating(unavailableResult(), 0)).toBeNull();
    expect(toStoredRating(rated({ numRatings: 0, quality: 0 }) as RatingResult, 0)).toBeNull();
    expect(toStoredRating(notListedResult(), 1_000)).toEqual({
      result: notListedResult(),
      expiresAt: 1_000 + TTL_SHORT_SECONDS * 1000,
    });

    if (!isRatingResult(shell) || !isCacheable(shell)) {
      throw new Error("zero-rating fixture was rejected");
    }
    expect(shell.status).toBe("unrated");
    expect(toStoredRating(shell, 5_000)?.expiresAt).toBe(5_000 + TTL_SHORT_SECONDS * 1000);

    if (!isRatingResult(scored) || !isCacheable(scored)) {
      throw new Error("rated fixture was rejected");
    }
    expect(toStoredRating(scored, 0)?.expiresAt).toBe(TTL_RATED_SECONDS * 1000);

    expect(
      parseRatingsResponse({
        cacheVersion: 3,
        results: {
          zero: rated({ numRatings: 0, quality: 0 }),
          shell,
          fallback: rated({ match: "exact", reasons: ["surname_fallback"] }),
          scored,
        },
      }),
    ).toEqual({
      cacheVersion: 3,
      results: { shell, scored },
    });
  });

  it("builds the Rate My Professors school ids", () => {
    expect(schoolGraphqlId(SCHOOL_IDS.queens)).toBe("U2Nob29sLTg0Mg==");
    expect(schoolGraphqlId(SCHOOL_IDS.statenIsland)).toBe("U2Nob29sLTM5OTE=");
    expect(schoolGraphqlId(SCHOOL_IDS.manhattan)).toBe("U2Nob29sLTQ5MDk=");
    expect(schoolGraphqlId(SCHOOL_IDS.generic)).toBe("U2Nob29sLTE3Njg3");
  });
});

describe("batch limits", () => {
  it("uses 8 for a known campus and 4 when the campus is unknown", () => {
    expect(batchSizeFor(" Queens Campus")).toBe(8);
    expect(batchSizeFor("Online Learning")).toBe(4);
    expect(batchSizeFor(null)).toBe(4);

    const queens = { campus: " Queens Campus" as string | null };
    const online = { campus: "Online Learning" as string | null };
    const chunks = chunkRequestItems([
      { ...queens, id: "q1" },
      { ...online, id: "o1" },
      { ...queens, id: "q2" },
      { ...online, id: "o2" },
      { ...online, id: "o3" },
      { ...online, id: "o4" },
    ]);
    expect(chunks.map((chunk) => chunk.map((item) => item.id))).toEqual([
      ["q1", "q2"],
      ["o1", "o2", "o3", "o4"],
    ]);

    const eightQueens = Array.from({ length: 8 }, (_, index) => ({
      key: `q${index}`,
      name: "Joan DeBello",
      campus: " Queens Campus",
      subject: "HISTORY",
    }));
    expect(parseRatingsRequest({ items: eightQueens }).ok).toBe(true);

    const fiveOnline = Array.from({ length: 5 }, (_, index) => ({
      key: `o${index}`,
      name: "Joan DeBello",
      campus: "Online Learning",
      subject: "THEOLOGY",
    }));
    expect(parseRatingsRequest({ items: fiveOnline }).ok).toBe(false);

    expect(
      parseRatingsRequest({
        items: [
          ...eightQueens.slice(0, 4),
          { key: "o", name: "Joan DeBello", campus: "Online Learning", subject: "THEOLOGY" },
        ],
      }).ok,
    ).toBe(false);
  });
});
