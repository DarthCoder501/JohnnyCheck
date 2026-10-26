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

function rank(bannerName: string, teachers: readonly Teacher[], campus = "Queens") {
  const name = parseInstructor(bannerName);
  if (name === null) {
    throw new Error(`unparsed ${bannerName}`);
  }
  return rankMatch(name, resolveCampus(campus), "Computer Science", teachers);
}

describe("rankMatch unique hit and completed miss", () => {
  it("returns exact for one own-school teacher with the same given and family keys", () => {
    const result = rank("Joan DeBello", [
      teacher(),
      teacher({ legacyId: 7, firstName: "Ann", lastName: "Smith", numRatings: 3, quality: 2 }),
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
    const bannerHasInitial = rank("Joan E. DeBello", [teacher({ firstName: "Joan" })]);
    const profileHasInitial = rank("Joan DeBello", [teacher({ firstName: "Joan E." })]);
    expect(bannerHasInitial).toMatchObject({ status: "rated", match: "exact", reasons: ["initial"] });
    expect(profileHasInitial).toMatchObject({ status: "rated", match: "exact", reasons: ["initial"] });
  });

  it("returns not_listed for a completed search with no family-key hit", () => {
    const result = rank("Joan DeBello", [
      teacher({ legacyId: 7, firstName: "Ann", lastName: "Smith" }),
      teacher({ legacyId: 8, firstName: "Robert", lastName: "Lee", numRatings: 0, quality: null }),
    ]);
    expect(result).toEqual({ status: "not_listed", ttlSeconds: TTL_SHORT_SECONDS });
  });
});
