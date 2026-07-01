"use client";

import { useCallback, useState } from "react";

const AUTO_SCROLL_STORAGE_KEY = "pi-auto-scroll-enabled";

export function useAutoScroll() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(AUTO_SCROLL_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  });

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(AUTO_SCROLL_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { autoScrollEnabled: enabled, onAutoScrollToggle: toggle };
}
