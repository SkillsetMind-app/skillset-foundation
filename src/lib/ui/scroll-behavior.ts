// O bloco de reduzir movimento do CSS nao alcanca a rolagem pedida em JS: um
// `behavior` explicito vence o `scroll-behavior: auto`. Quem rola por JS pergunta aqui.
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
