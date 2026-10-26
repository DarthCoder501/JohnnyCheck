const NICKNAME_GROUPS: readonly (readonly string[])[] = [
  ["robert", "rob", "robbie", "bob", "bobby", "bert"],
  ["william", "will", "willy", "bill", "billy", "liam"],
  ["richard", "rich", "richie", "rick", "ricky", "dick"],
  ["james", "jim", "jimmy", "jamie"],
  ["john", "jack", "johnny", "jon"],
  ["jonathan", "jon", "jonny"],
  ["joseph", "joe", "joey"],
  ["thomas", "tom", "tommy"],
  ["michael", "mike", "mikey", "mick"],
  ["christopher", "chris", "kit"],
  ["christina", "christine", "kristina", "kristine", "chris", "tina", "chrissy"],
  ["elizabeth", "liz", "lizzie", "beth", "betty", "eliza", "libby"],
  ["katherine", "catherine", "kathryn", "katharine", "kate", "katie", "kathy", "cathy", "kat"],
  ["margaret", "maggie", "meg", "peggy", "marge", "margie", "greta"],
  ["patricia", "pat", "patty", "trish", "tricia"],
  ["patrick", "pat", "paddy"],
  ["edward", "ed", "eddie", "ted", "ned"],
  ["anthony", "tony"],
  ["daniel", "dan", "danny"],
  ["david", "dave", "davey"],
  ["stephen", "steven", "steve"],
  ["jennifer", "jen", "jenny"],
  ["jessica", "jess", "jessie"],
  ["rebecca", "becky", "becca"],
  ["susan", "sue", "susie"],
  ["deborah", "debra", "deb", "debbie"],
  ["barbara", "barb"],
  ["alexander", "alex", "sasha"],
  ["alexandra", "alex", "sasha", "lexi"],
  ["andrew", "andy", "drew"],
  ["benjamin", "ben", "benny"],
  ["charles", "charlie", "chuck", "chas"],
  ["frederick", "fred", "freddie"],
  ["gerald", "gerry", "jerry"],
  ["gregory", "greg"],
  ["henry", "hank", "harry"],
  ["harold", "hal", "harry"],
  ["jacob", "jake"],
  ["geoffrey", "jeffrey", "jeffery", "geoff", "jeff"],
  ["joshua", "josh"],
  ["kenneth", "ken", "kenny"],
  ["lawrence", "laurence", "larry"],
  ["leonard", "leo", "len", "lenny"],
  ["matthew", "matt"],
  ["nicholas", "nick", "nicky"],
  ["peter", "pete"],
  ["philip", "phillip", "phil"],
  ["raymond", "ray"],
  ["ronald", "ron", "ronnie"],
  ["samuel", "sam", "sammy"],
  ["samantha", "sam", "sammy"],
  ["timothy", "tim", "timmy"],
  ["vincent", "vince", "vinny"],
  ["zachary", "zach", "zack"],
  ["abigail", "abby"],
  ["cynthia", "cindy"],
  ["dorothy", "dot", "dottie"],
  ["eleanor", "ellie", "nora"],
  ["frances", "fran"],
  ["francis", "frank"],
  ["francisco", "frank", "paco", "pancho"],
  ["jose", "pepe"],
  ["judith", "judy"],
  ["kimberly", "kim"],
  ["pamela", "pam"],
  ["sandra", "sandy"],
  ["teresa", "theresa", "terry", "tess"],
  ["terrence", "terence", "terry"],
  ["victoria", "vicky", "tori"],
  ["virginia", "ginny"],
  ["douglas", "doug"],
  ["donald", "don", "donny"],
  ["albert", "al", "bert"],
  ["alfred", "al", "fred"],
  ["alan", "allan", "allen", "al"],
  ["arthur", "art"],
  ["bradley", "brad"],
  ["eugene", "gene"],
  ["herbert", "herb"],
  ["louis", "lou"],
  ["mitchell", "mitch"],
  ["nathaniel", "nathan", "nate", "nat"],
  ["reginald", "reggie"],
  ["russell", "russ"],
  ["stanley", "stan"],
  ["theodore", "ted", "teddy", "theo"],
  ["walter", "walt", "wally"],
  ["wesley", "wes"],
  ["mohammad", "mohammed", "muhammad", "muhammed", "mohamed", "mohamad"],
  ["ahmed", "ahmad"],
  ["yusuf", "yousef", "youssef", "yosef"],
];

const GROUPS_BY_NAME: ReadonlyMap<string, readonly number[]> = (() => {
  const index = new Map<string, number[]>();
  NICKNAME_GROUPS.forEach((group, groupIndex) => {
    for (const name of group) {
      const groups = index.get(name);
      if (groups) {
        groups.push(groupIndex);
      } else {
        index.set(name, [groupIndex]);
      }
    }
  });
  return index;
})();

/** Both arguments are comparison keys (see `nameKey`). Equal keys are not nicknames of each other. */
export function areNicknames(a: string, b: string): boolean {
  if (a === b) {
    return false;
  }
  const groupsOfA = GROUPS_BY_NAME.get(a);
  const groupsOfB = GROUPS_BY_NAME.get(b);
  if (!groupsOfA || !groupsOfB) {
    return false;
  }
  return groupsOfA.some((group) => groupsOfB.includes(group));
}
