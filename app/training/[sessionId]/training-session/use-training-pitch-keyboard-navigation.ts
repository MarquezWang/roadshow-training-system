"use client";

import { useEffect } from "react";

type PitchPageDirection = "PREV" | "NEXT";

type UseTrainingPitchKeyboardNavigationOptions = Readonly<{
  changePage: (
    direction: PitchPageDirection,
  ) => void | Promise<void>;
}>;

function isEditableOrClickableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="button"]',
    ),
  );
}

export function useTrainingPitchKeyboardNavigation({
  changePage,
}: UseTrainingPitchKeyboardNavigationOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableOrClickableTarget(event.target)) {
        return;
      }

      if (
        event.key === "ArrowLeft" ||
        event.key === "PageUp" ||
        event.key === "Backspace"
      ) {
        event.preventDefault();
        void changePage("PREV");
      }

      if (
        event.key === "ArrowRight" ||
        event.key === "PageDown" ||
        event.key === " " ||
        event.key === "Spacebar" ||
        event.key === "Enter"
      ) {
        event.preventDefault();
        void changePage("NEXT");
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changePage]);
}
