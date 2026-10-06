"use client";

import { createContext, useContext, type ReactNode } from "react";

// Existe curso real publicado? Quem decide é o servidor (hasRealPublishedCourse,
// lido uma vez no layout raiz); as ilhas cliente que levam à loja — barra, hero,
// vitrines de instrutor, verificação de certificado — só leem daqui, sem buscar
// nada no navegador. Sem provedor vale "não", a mesma resposta de uma leitura
// que falhou: a loja fica escondida.
const RealCoursesContext = createContext(false);

export function RealCoursesProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <RealCoursesContext value={value}>{children}</RealCoursesContext>;
}

export function useHasRealCourses() {
  return useContext(RealCoursesContext);
}
