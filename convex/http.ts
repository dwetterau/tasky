import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Enable CORS since frontend (Next.js) is on a different domain
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
