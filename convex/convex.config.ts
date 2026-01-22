import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config.js";

const app = defineApp();
app.use(betterAuth);
export default app;
