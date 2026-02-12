import type { KeyboardEvent } from "react";

/**
 * Returns an onKeyDown handler that calls `callback` when Cmd+Enter (Mac)
 * or Ctrl+Enter (Linux/Windows) is pressed. Useful for submitting modal
 * forms from a textarea without losing multi-line editing.
 */
export function submitOnCmdEnter(callback: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      callback();
    }
  };
}
