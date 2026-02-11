"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface SavingContextValue {
  isSaving: boolean;
  startSaving: () => void;
  doneSaving: () => void;
}

const SavingContext = createContext<SavingContextValue | null>(null);

export function SavingProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0);
  const [isSaving, setIsSaving] = useState(false);

  const startSaving = useCallback(() => {
    countRef.current += 1;
    if (countRef.current === 1) {
      setIsSaving(true);
    }
  }, []);

  const doneSaving = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current === 0) {
      setIsSaving(false);
    }
  }, []);

  // Prevent tab close / refresh while saving
  useEffect(() => {
    if (!isSaving) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isSaving]);

  return (
    <SavingContext.Provider value={{ isSaving, startSaving, doneSaving }}>
      {children}
    </SavingContext.Provider>
  );
}

export function useSaving(): SavingContextValue {
  const ctx = useContext(SavingContext);
  if (!ctx) {
    throw new Error("useSaving must be used within a SavingProvider");
  }
  return ctx;
}
