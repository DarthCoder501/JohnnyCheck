import { paintInstructorCell } from "../extension/src/chip";

(globalThis as { paintInstructorCell?: typeof paintInstructorCell }).paintInstructorCell = paintInstructorCell;
