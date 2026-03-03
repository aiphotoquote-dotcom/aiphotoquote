// src/components/admin/quote/RenderAutoFocus.tsx
"use client";

import React, { useEffect, useRef } from "react";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function RenderAutoFocus(props: {
  active: boolean;
  targetId?: string;
  behavior?: ScrollBehavior;
  offsetPx?: number;
}) {
  const { active, targetId = "renders", behavior = "smooth", offsetPx = 16 } = props;

  const didScrollRef = useRef(false);

  useEffect(() => {
    if (!active) {
      // Reset so a *new* render session can auto-focus again later.
      didScrollRef.current = false;
      return;
    }

    if (didScrollRef.current) return;

    const el = document.getElementById(targetId);
    if (!el) return;

    didScrollRef.current = true;

    // Small timeout lets the UI paint the progress bar first.
    const t = setTimeout(() => {
      try {
        el.scrollIntoView({ behavior, block: "start" });

        // Apply a little offset so the header isn’t flush at top.
        const y = window.scrollY;
        const nextY = y - clamp(Number(offsetPx) || 0, 0, 120);
        if (Number.isFinite(nextY)) window.scrollTo({ top: nextY, behavior });
      } catch {
        // no-op
      }
    }, 80);

    return () => clearTimeout(t);
  }, [active, targetId, behavior, offsetPx]);

  return null;
}