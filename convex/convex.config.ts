import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({ env: { JEV_API_KEY: v.optional(v.string()) } });
export default app;
