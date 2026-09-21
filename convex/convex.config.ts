import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { v } from "convex/values";

const app = defineApp({ env: { JEV_API_KEY: v.optional(v.string()) } });
app.use(rateLimiter);
export default app;
