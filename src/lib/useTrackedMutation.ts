"use client";

import { useMutation } from "convex/react";
import type { ReactMutation } from "convex/react";
import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import { useSaving } from "./SavingContext";

type MutateFn<Mutation extends FunctionReference<"mutation">> = (
  ...args: OptionalRestArgs<Mutation>
) => Promise<FunctionReturnType<Mutation>>;

function wrapWithTracking<Mutation extends FunctionReference<"mutation">>(
  fn: MutateFn<Mutation>,
  startSaving: () => void,
  doneSaving: () => void,
): MutateFn<Mutation> {
  return (...args) => {
    startSaving();
    const result = fn(...args);
    result.then(doneSaving, doneSaving);
    return result;
  };
}

/**
 * Drop-in replacement for Convex's `useMutation` that automatically tracks
 * in-flight mutations in the global SavingProvider. Shows "Saving..." in the
 * navbar and prevents tab close while any mutation is pending.
 */
export function useTrackedMutation<
  Mutation extends FunctionReference<"mutation">,
>(mutation: Mutation): ReactMutation<Mutation> {
  const { startSaving, doneSaving } = useSaving();
  const raw = useMutation(mutation);

  const tracked = wrapWithTracking(
    raw as MutateFn<Mutation>,
    startSaving,
    doneSaving,
  ) as ReactMutation<Mutation>;

  tracked.withOptimisticUpdate = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optimisticUpdate: any,
  ): ReactMutation<Mutation> => {
    const withOpt = raw.withOptimisticUpdate(optimisticUpdate);

    const trackedWithOpt = wrapWithTracking(
      withOpt as MutateFn<Mutation>,
      startSaving,
      doneSaving,
    ) as ReactMutation<Mutation>;

    trackedWithOpt.withOptimisticUpdate = tracked.withOptimisticUpdate;
    return trackedWithOpt;
  };

  return tracked;
}
