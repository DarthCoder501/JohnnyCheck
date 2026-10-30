import { describe, expect, it } from "vitest";
import { resolveCampus } from "../../shared/src/campus";
import {
  SCHOOL_IDS,
  TTL_RATED_SECONDS,
  TTL_SHORT_SECONDS,
  isRatingResult,
} from "../../shared/src/contract";
import { parseInstructor } from "../../shared/src/names";
import { rankMatch, type Teacher } from "../../shared/src/rank";

function teacher(overrides: Partial<Teacher> = {}): Teacher {
  return {
    legacyId: 42,
    schoolId: SCHOOL_IDS.queens,
    firstName: "Joan",
    lastName: "DeBello",
    department: "Computer Science",
    schoolName: "St. John's University - Jamaica/Queens",
    numRatings: 28,
    quality: 4.5,
    difficulty: 3.1,
    wouldTakeAgain: 80,
    ...overrides,
  };
}

function rank(
  bannerName: string,
  teachers: readonly Teacher[],
  campus = "Queens",
  subject: string | null = "Computer Science",
) {
  const name = parseInstructor(bannerName);
  if (name === null) {
    throw new Error(`unparsed ${bannerName}`);
  }
  return rankMatch(name, resolveCampus(campus), subject, teachers);
}

describe("rankMatch unique hit and completed miss", () => {
  it("returns exact for one own-school teacher with the same given and family keys", () => {
    const result = rank("Joan DeBello", [
      teacher(),
      teacher({
        legacyId: 7,
        firstName: "Ann",
        lastName: "Smith",
        numRatings: 3,
        quality: 2,
      }),
    ]);
    expect(isRatingResult(result)).toBe(true);
    expect(result).toMatchObject({
      status: "rated",
      match: "exact",
      legacyId: 42,
      numRatings: 28,
      quality: 4.5,
      ttlSeconds: TTL_RATED_SECONDS,
    });
  });

  it("returns unrated with null scores when the profile has zero ratings", () => {
    const result = rank("Joan DeBello", [
      teacher({ numRatings: 0, quality: 0, difficulty: 0, wouldTakeAgain: 0 }),
    ]);
    expect(result).toMatchObject({
      status: "unrated",
      match: "exact",
      legacyId: 42,
      numRatings: 0,
      quality: null,
      difficulty: null,
      wouldTakeAgain: null,
      ttlSeconds: TTL_SHORT_SECONDS,
    });
  });

  it("keeps a middle initial on only one side exact with reason initial", () => {
    const bannerHasInitial = rank("Joan E. DeBello", [
      teacher({ firstName: "Joan" }),
    ]);
    const profileHasInitial = rank("Joan DeBello", [
      teacher({ firstName: "Joan E." }),
    ]);
    expect(bannerHasInitial).toMatchObject({
      status: "rated",
      match: "exact",
      reasons: ["initial"],
    });
    expect(profileHasInitial).toMatchObject({
      status: "rated",
      match: "exact",
      reasons: ["initial"],
    });
  });

  it("returns not_listed for a completed search with no family-key hit", () => {
    const result = rank("Joan DeBello", [
      teacher({ legacyId: 7, firstName: "Ann", lastName: "Smith" }),
      teacher({
        legacyId: 8,
        firstName: "Robert",
        lastName: "Lee",
        numRatings: 0,
        quality: null,
      }),
    ]);
    expect(result).toEqual({
      status: "not_listed",
      ttlSeconds: TTL_SHORT_SECONDS,
    });
  });
});

describe("rankMatch possible matches", () => {
  it("treats a final-token surname as possible and a full particle family as exact", () => {
    const fallback = rank("Thanh Van Nguyen", [
      teacher({
        legacyId: 11,
        firstName: "Thanh",
        lastName: "Nguyen",
        quality: 3.2,
        numRatings: 6,
      }),
    ]);
    const full = rank("Thanh Van Nguyen", [
      teacher({
        legacyId: 11,
        firstName: "Thanh",
        lastName: "Nguyen",
        quality: 3.2,
        numRatings: 6,
      }),
      teacher({
        legacyId: 12,
        firstName: "Thanh",
        lastName: "Van Nguyen",
        quality: 4.8,
        numRatings: 15,
      }),
    ]);
    const cruz = rank("Maria De La Cruz", [
      teacher({
        legacyId: 13,
        firstName: "Maria",
        lastName: "Cruz",
        quality: 2.5,
        numRatings: 4,
      }),
    ]);
    expect(
      isRatingResult(fallback) && isRatingResult(full) && isRatingResult(cruz),
    ).toBe(true);
    expect(fallback).toMatchObject({
      status: "rated",
      match: "possible",
      reasons: ["surname_fallback"],
      legacyId: 11,
      quality: 3.2,
      numRatings: 6,
    });
    expect(full).toMatchObject({
      match: "exact",
      legacyId: 12,
      quality: 4.8,
      numRatings: 15,
    });
    expect(cruz).toMatchObject({
      match: "possible",
      reasons: ["surname_fallback"],
      legacyId: 13,
      quality: 2.5,
    });
  });

  it("returns possible with the reason for each uncertain person", () => {
    const nickname = rank("Christopher Smith", [
      teacher({
        legacyId: 21,
        firstName: "Chris",
        lastName: "Smith",
        quality: 3.3,
        numRatings: 9,
      }),
    ]);
    const middles = rank("Joan E. DeBello", [
      teacher({ firstName: "Joan L.", quality: 4.1, numRatings: 8 }),
    ]);
    const tied = rank(
      "John Smith",
      [
        teacher({
          legacyId: 31,
          firstName: "John",
          lastName: "Smith",
          department: "Computer Science",
          quality: 2,
          numRatings: 4,
        }),
        teacher({
          legacyId: 32,
          firstName: "John",
          lastName: "Smith",
          department: "Computer Information Systems",
          quality: 5,
          numRatings: 40,
        }),
      ],
      "Queens",
      "COMPUTER SCIENCE - CCPS",
    );
    const department = rank("Joan DeBello", [
      teacher({ department: "History", quality: 4.5, numRatings: 28 }),
    ]);
    const statenIsland = rank("Joan DeBello", [teacher()], "Staten Island");
    const manhattan = rank("Joan DeBello", [teacher()], "Manhattan");
    const unknownMany = rank(
      "Joan DeBello",
      [
        teacher({ legacyId: 41, schoolId: SCHOOL_IDS.queens, quality: 4.5 }),
        teacher({
          legacyId: 42,
          schoolId: SCHOOL_IDS.manhattan,
          quality: 1.2,
          numRatings: 3,
        }),
      ],
      "Online Learning",
    );
    for (const result of [
      nickname,
      middles,
      tied,
      department,
      statenIsland,
      manhattan,
      unknownMany,
    ]) {
      expect(isRatingResult(result)).toBe(true);
    }
    expect(nickname).toMatchObject({
      match: "possible",
      reasons: ["nickname"],
      legacyId: 21,
      quality: 3.3,
    });
    const facultySpelling = rank("Marc Smith", [
      teacher({
        legacyId: 22,
        firstName: "Mark",
        lastName: "Smith",
        quality: 4.2,
        numRatings: 11,
      }),
    ]);
    expect(facultySpelling).toMatchObject({
      match: "possible",
      reasons: ["nickname"],
      legacyId: 22,
      quality: 4.2,
    });
    expect(middles).toMatchObject({
      match: "possible",
      reasons: ["middle_conflict"],
      quality: 4.1,
      numRatings: 8,
    });
    expect(tied).toMatchObject({
      match: "possible",
      reasons: ["same_name"],
      legacyId: 31,
      quality: 2,
    });
    expect(department).toMatchObject({
      match: "possible",
      reasons: ["department_conflict"],
      quality: 4.5,
    });
    expect(statenIsland).toMatchObject({
      match: "possible",
      reasons: ["cross_campus"],
      legacyId: 42,
    });
    expect(manhattan).toMatchObject({
      match: "possible",
      reasons: ["cross_campus"],
    });
    expect(unknownMany).toMatchObject({
      match: "possible",
      reasons: ["unknown_campus"],
    });
    const ownCampusWins = rank(
      "Joan DeBello",
      [
        teacher({
          legacyId: 61,
          schoolId: SCHOOL_IDS.queens,
          quality: 5,
          numRatings: 40,
        }),
        teacher({
          legacyId: 62,
          schoolId: SCHOOL_IDS.statenIsland,
          quality: 4.5,
          numRatings: 28,
        }),
      ],
      "Staten Island",
    );
    expect(isRatingResult(ownCampusWins)).toBe(true);
    expect(ownCampusWins).toMatchObject({
      match: "exact",
      legacyId: 62,
      quality: 4.5,
    });
  });

  it("does not treat Christopher and Christina as the same person", () => {
    const result = rank("Christopher Smith", [
      teacher({
        firstName: "Christina",
        lastName: "Smith",
        quality: 4.9,
        numRatings: 12,
      }),
    ]);
    expect(result).toEqual({
      status: "not_listed",
      ttlSeconds: TTL_SHORT_SECONDS,
    });
  });

  it("returns exact for one person when the campus is unknown", () => {
    const result = rank(
      "Joan DeBello",
      [teacher({ schoolId: SCHOOL_IDS.statenIsland })],
      "Online Learning",
    );
    expect(isRatingResult(result)).toBe(true);
    expect(result).toMatchObject({
      status: "rated",
      match: "exact",
      legacyId: 42,
      quality: 4.5,
    });
  });

  it("keeps the closer subject instead of the higher score", () => {
    const result = rank(
      "John Smith",
      [
        teacher({
          legacyId: 51,
          firstName: "John",
          lastName: "Smith",
          department: "History",
          quality: 5,
          numRatings: 40,
        }),
        teacher({
          legacyId: 52,
          firstName: "John",
          lastName: "Smith",
          department: "Computer Science",
          quality: 2,
          numRatings: 4,
        }),
      ],
      "Queens",
      "COMPUTER SCIENCE - CCPS",
    );
    expect(isRatingResult(result)).toBe(true);
    expect(result).toMatchObject({
      match: "exact",
      legacyId: 52,
      quality: 2,
      numRatings: 4,
    });
  });
});
