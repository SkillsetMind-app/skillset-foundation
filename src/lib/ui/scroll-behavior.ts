// The reduced-motion block in CSS does not reach scrolling requested from JS: an
// explicit `behavior` beats `scroll-behavior: auto`. Anything that scrolls from JS asks here.
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
