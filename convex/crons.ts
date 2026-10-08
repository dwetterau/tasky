import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval(
  "dispatch homepage exports",
  { minutes: 1 },
  internal.homepage.dispatch,
  {},
);
crons.daily(
  "sync portfolio prices",
  { hourUTC: 22, minuteUTC: 15 },
  internal.portfolioSync.dispatchDaily,
  {},
);
crons.hourly(
  "clean MCP refresh claims",
  { minuteUTC: 40 },
  internal.mcpAuth.cleanup,
  {},
);
crons.daily(
  "sync journals",
  { hourUTC: 9, minuteUTC: 15 },
  internal.journalImport.dispatch,
  {},
);
export default crons;
