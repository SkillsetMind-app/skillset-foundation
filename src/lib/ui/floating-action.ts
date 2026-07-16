export type FloatingActionId = "help" | "advisor";

const FLOATING_ACTION_OPENED = "skillsetmind:floating-action-opened";

export function announceFloatingAction(action: FloatingActionId) {
  window.dispatchEvent(
    new CustomEvent<FloatingActionId>(FLOATING_ACTION_OPENED, { detail: action }),
  );
}

export function onFloatingActionOpened(
  listener: (action: FloatingActionId) => void,
) {
  const handleOpened = (event: Event) => {
    listener((event as CustomEvent<FloatingActionId>).detail);
  };

  window.addEventListener(FLOATING_ACTION_OPENED, handleOpened);
  return () => window.removeEventListener(FLOATING_ACTION_OPENED, handleOpened);
}
