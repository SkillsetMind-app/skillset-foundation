"use client";

import { createContext, useContext } from "react";

/**
 * true enquanto a janela dos termos está na tela, ou enquanto ainda não se
 * sabe se ela vai aparecer (sessão carregando, perfil da conta não lido). Os
 * tours de boas-vindas esperam por isto: abertos junto com a janela, os dois
 * prendiam o Tab e o foco podia ficar no tour, atrás da janela.
 *
 * Arquivo próprio, fora do auth-provider, de propósito: dezenas de testes
 * trocam o auth-provider inteiro por um mock, e um export novo lá faltaria
 * em todos eles. Sem provedor (testes, páginas sem AuthProvider) vale false.
 */
export const LegalGateContext = createContext(false);

export function useLegalGateWaiting() {
  return useContext(LegalGateContext);
}
