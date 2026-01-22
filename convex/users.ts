import { query } from "./_generated/server";
import { authComponent } from "./auth";

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    return user ?? null;
  },
});
