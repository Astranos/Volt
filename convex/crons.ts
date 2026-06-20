import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("cleanup expired scanner signaling state", { minutes: 5 }, internal.scannerSignal.cleanupExpired, {});

export default crons;
