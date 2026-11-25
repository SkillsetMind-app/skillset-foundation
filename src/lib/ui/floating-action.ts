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

// The Help button ("How do I do X on the platform") opens the studio Advisor
// without knowing the component: it asks through the same window event bus.
const ADVISOR_OPEN_REQUESTED = "skillsetmind:advisor-open-requested";

export function requestAdvisorOpen() {
  window.dispatchEvent(new Event(ADVISOR_OPEN_REQUESTED));
}

export function onAdvisorOpenRequested(listener: () => void) {
  window.addEventListener(ADVISOR_OPEN_REQUESTED, listener);
  return () => window.removeEventListener(ADVISOR_OPEN_REQUESTED, listener);
}
