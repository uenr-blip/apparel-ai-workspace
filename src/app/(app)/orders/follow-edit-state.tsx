"use client";

import { createContext, useContext, useMemo, useState, type ReactNode, useEffect } from "react";

const FollowEditContext = createContext<{ refreshing: boolean; saved: (stamp: string) => void; dirty: boolean; setDirty: (value: boolean) => void; stageEditing: boolean; setStageEditing: (value: boolean) => void } | null>(null);
export const useFollowEditState = () => useContext(FollowEditContext);

export function FollowEditProvider({ children, expectedUpdatedAt = "" }: { children: ReactNode; expectedUpdatedAt?: string }) {
  const [savedStamp, saved] = useState("");
  // ISO server timestamps: keep downstream actions closed until the saved snapshot returns.
  const refreshing = Boolean(savedStamp && expectedUpdatedAt < savedStamp);
  const [dirty, setDirty] = useState(false);
  const [stageEditing, setStageEditing] = useState(false);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || stageEditing) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, stageEditing]);
  const value = useMemo(() => ({ refreshing, saved, dirty, setDirty, stageEditing, setStageEditing }), [refreshing, dirty, stageEditing]);
  return <FollowEditContext.Provider value={value}>{children}</FollowEditContext.Provider>;
}
