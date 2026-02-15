import { useMemo } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  size,
  autoUpdate,
  type Middleware,
} from "@floating-ui/react";

/**
 * Shared popover positioning hook using Floating UI.
 * Handles flip (above/below), shift (horizontal edges), width matching,
 * and auto-updates on scroll/resize.
 *
 * @param isOpen - whether the popover is currently open
 * @param options.matchWidth - sync the floating element's width to the reference (default: true)
 */
export function usePopover(
  isOpen: boolean,
  options?: { matchWidth?: boolean }
) {
  const matchWidth = options?.matchWidth ?? true;

  const middleware = useMemo<Middleware[]>(
    () => [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      ...(matchWidth
        ? [
            size({
              apply({ rects, elements }) {
                elements.floating.style.width = `${rects.reference.width}px`;
              },
            }),
          ]
        : []),
    ],
    [matchWidth]
  );

  return useFloating({
    open: isOpen,
    placement: "bottom-start",
    strategy: "fixed",
    middleware,
    whileElementsMounted: autoUpdate,
  });
}
