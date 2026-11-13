import { cronJobs, makeFunctionReference } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();
const cleanupUsageSessions = makeFunctionReference<"mutation", Record<string, never>, { ended: number }>(
  "access:cleanupUsageSessions",
);

crons.interval(
  "cleanup expired scanner signaling state",
  { minutes: 5 },
  internal.scannerSignal.cleanup.cleanupExpired,
  {},
);

crons.interval(
  "end expired scanner usage sessions",
  { minutes: 5 },
  cleanupUsageSessions,
  {},
);

crons.interval(
  "sweep expired workspace presence",
  { seconds: 60 },
  internal.cloudWorkspace.sweepExpiredPresence,
  {},
);

crons.interval(
  "sweep expired cursor deliveries",
  { seconds: 60 },
  internal.cloudWorkspace.sweepExpiredCursorDeliveries,
  {},
);

crons.interval(
  "sweep mobile sign-in requests",
  { seconds: 60 },
  internal.mobileSignIn.sweep,
  {},
);

crons.interval("expire managed workspace history", { minutes: 5 }, makeFunctionReference<"mutation">("workspaceStorage:sweepRetention"), {});
crons.interval("purge expired workspace objects", { minutes: 5 }, makeFunctionReference<"action">("workspaceStorage:purgeExpiredObjects"), {});

export default crons;
