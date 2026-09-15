import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("dispatch homepage exports", { minutes: 1 }, internal.homepage.dispatch, {});
export default crons;
