"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

// A busca morava DENTRO da barra lateral e só existia com ela expandida: quem
// recolhia o rail para ganhar tela perdia a busca, e no celular — onde a barra
// vira gaveta — ela não existia em largura nenhuma. Buscar não é navegação de
// menu, é uma ação da página: agora vive na barra do topo, que está presente em
// toda largura (achado F26 da auditoria).

export function PlatformSearch({
  pathname,
  open = false,
}: {
  pathname: string;
  /** No celular a barra do topo não tem largura para o campo; um ícone o abre. */
  open?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { t } = useTranslation();
  const placeholder = t(getSearchPlaceholderKey(pathname));
  const shortcutLabel = useShortcutLabel();

  function submitSearch() {
    const query = inputRef.current?.value.trim();

    if (!query) {
      return;
    }

    const target = pathname.startsWith("/ops")
      ? `/ops?q=${encodeURIComponent(query)}`
      : pathname.startsWith("/teach")
        ? `/teach?query=${encodeURIComponent(query)}`
        : `/courses?q=${encodeURIComponent(query)}`;

    router.push(target);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      submitSearch();
    }
  }

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
    }

    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <label className="platform-topbar-search" data-open={open ? "true" : "false"}>
      <Search aria-hidden="true" size={15} strokeWidth={2} />
      <input
        ref={inputRef}
        type="search"
        placeholder={placeholder}
        aria-label={placeholder}
        onKeyDown={handleKeyDown}
      />
      {shortcutLabel ? <span aria-hidden="true">{shortcutLabel}</span> : null}
    </label>
  );
}

const EMPTY_SUBSCRIBE = () => () => {};

/**
 * A dica dizia "Ctrl K" fixa, inclusive no Mac, onde o atalho é ⌘K — e o
 * ouvinte sempre aceitou as duas teclas. O servidor não sabe qual é o teclado
 * de quem vai ler, então o instantâneo do servidor é `null` e nada é escrito;
 * o rótulo certo entra na hidratação, sem divergência. É decorativo
 * (aria-hidden), então nascer um quadro depois não custa a ninguém.
 */
function useShortcutLabel() {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    // ponytail: navigator.platform está depreciado mas é o único campo que
    // todo navegador ainda preenche; o userAgent cobre o resto.
    () =>
      /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`)
        ? "⌘K"
        : "Ctrl K",
    () => null,
  );
}

function getSearchPlaceholderKey(pathname: string) {
  if (pathname.startsWith("/teach")) {
    return "platform.searchTeachPlaceholder";
  }

  if (pathname.startsWith("/learn")) {
    return "platform.searchLearnPlaceholder";
  }

  if (pathname.startsWith("/ops")) {
    return "platform.searchOpsPlaceholder";
  }

  return "platform.searchDefaultPlaceholder";
}
