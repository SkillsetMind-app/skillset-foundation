"use client";

import { useEffect } from "react";

export function ConsoleSignature() {
  useEffect(() => {
    console.info(
      "%cSkillsetMind",
      "color:#183a63;font-size:24px;font-weight:700;",
      "\nBuilt by Patrick Simon. Hope you are enjoying the experience. Good luck.",
    );
  }, []);

  return null;
}
