"use client";

import { CheckCircle2, ChevronDown, LockKeyhole, PlayCircle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { LessonUnlockState } from "@/domain/drip-policy";
import type { CourseModule } from "@/domain/learning";
import { LessonThumbnail } from "@/components/learn/lesson-thumbnail";

type CoursePlaylistProps = {
  thumbnailUrlByLessonId?: ReadonlyMap<string, string>;
  modules: CourseModule[];
  selectedLessonId: string | null;
  completedLessonIds: string[];
  unlockStateById: Map<string, LessonUnlockState>;
  onSelect: (lessonId: string) => void;
  /** Só o check da aula concluída é clicável — para desfazer. Concluir mora
   *  num lugar só: o botão sob o vídeo (e o avanço automático). */
  onUncomplete?: (lessonId: string) => void;
};

// A playlist ao lado do vídeo.
//
// POR QUE ISTO EXISTE
//
// A lista de aulas existia três vezes na sala — cartão "Continuar", trilho de
// módulos + grade de cartões, e a janela "Todas as aulas" — e nenhuma ficava
// visível enquanto o vídeo tocava. Ao lado do vídeo havia um cartão de números
// ("Aula 3/12 · Arquivos 2"). O que o aluno quer ali é a lista: módulos em
// acordeão, aula atual destacada, check e cadeado por aula, busca no topo.
export function CoursePlaylist({
  thumbnailUrlByLessonId,
  modules,
  selectedLessonId,
  completedLessonIds,
  unlockStateById,
  onSelect,
  onUncomplete,
}: CoursePlaylistProps) {
  const [query, setQuery] = useState("");
  // A aula atual era destacada mas a lista nao rolava ate ela: trocar de aula
  // (ou o avanco automatico) deixava o destaque fora da area visivel da
  // playlist e a pessoa perdia o lugar. `block: "nearest"` rola o minimo — e
  // nao mexe em nada se a linha ja estiver a vista.
  const currentLessonRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    currentLessonRef.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [selectedLessonId]);
  // Módulos fechados pela pessoa. O módulo da aula atual abre sozinho; os
  // demais começam fechados, e a busca abre tudo que tiver resultado.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const normalizedQuery = query.trim().toLowerCase();
  const activeModuleId =
    modules.find((module) =>
      module.lessons.some((lesson) => lesson.id === selectedLessonId),
    )?.id ?? modules[0]?.id ?? null;

  // Numeração absoluta no curso inteiro: filtrar nunca renumera.
  const groups = useMemo(() => {
    let position = 0;
    return modules.map((module) => {
      const lessons = module.lessons.map((lesson) => {
        position += 1;
        return { lesson, position };
      });
      return {
        module,
        total: module.lessons.length,
        lessons: normalizedQuery
          ? lessons.filter(({ lesson }) =>
              lesson.title.toLowerCase().includes(normalizedQuery),
            )
          : lessons,
      };
    });
  }, [modules, normalizedQuery]);

  const matchCount = groups.reduce((total, group) => total + group.lessons.length, 0);

  return (
    <nav className="member-playlist" aria-label="Lessons">
      <label className="member-playlist__search">
        <Search aria-hidden="true" size={15} strokeWidth={1.8} />
        <span className="sr-only">Search lessons</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search lessons"
        />
      </label>
      {normalizedQuery ? (
        <p aria-live="polite" className="member-playlist__count">
          {matchCount} lesson{matchCount === 1 ? "" : "s"} match &quot;{query.trim()}&quot;
        </p>
      ) : null}

      <ol className="member-playlist__modules">
        {groups.map((group, moduleIndex) => {
          if (normalizedQuery && group.lessons.length === 0) {
            return null;
          }
          const isOpen = normalizedQuery
            ? true
            : !(collapsed[group.module.id] ?? group.module.id !== activeModuleId);
          const doneCount = group.module.lessons.filter((lesson) =>
            completedLessonIds.includes(lesson.id),
          ).length;
          const panelId = `playlist-${group.module.id}`;

          return (
            <li key={group.module.id} className="member-playlist__module">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() =>
                  setCollapsed((current) => ({
                    ...current,
                    [group.module.id]: isOpen,
                  }))
                }
                className="member-playlist__module-head"
              >
                <span className="member-playlist__module-title">
                  <span className="member-playlist__module-eyebrow">
                    Module {moduleIndex + 1}
                  </span>
                  {group.module.title}
                </span>
                <span className="member-playlist__module-meta">
                  {doneCount}/{group.total}
                  <ChevronDown
                    aria-hidden="true"
                    size={15}
                    strokeWidth={2}
                    className={`member-playlist__chevron ${isOpen ? "is-open" : ""}`}
                  />
                </span>
              </button>

              {isOpen ? (
                <ul id={panelId} className="member-playlist__lessons">
                  {group.lessons.map(({ lesson, position }) => {
                    const isCompleted = completedLessonIds.includes(lesson.id);
                    const isSelected = selectedLessonId === lesson.id;
                    const unlocked = unlockStateById.get(lesson.id)?.unlocked ?? true;

                    return (
                      <li
                        key={lesson.id}
                        ref={isSelected ? currentLessonRef : undefined}
                        className={`member-playlist__lesson ${isSelected ? "is-current" : ""} ${
                          isCompleted ? "is-done" : ""
                        } ${unlocked ? "" : "is-locked"}`}
                      >
                        {isCompleted && onUncomplete ? (
                          <button
                            type="button"
                            onClick={() => onUncomplete(lesson.id)}
                            aria-label={`Mark "${lesson.title}" incomplete`}
                            title="Mark incomplete"
                            className="member-playlist__status member-playlist__status--button"
                          >
                            <CheckCircle2 aria-hidden size={15} />
                          </button>
                        ) : (
                          <span className="member-playlist__status" aria-hidden="true">
                            {isCompleted ? (
                              <CheckCircle2 size={15} />
                            ) : isSelected ? (
                              <PlayCircle size={15} />
                            ) : unlocked ? (
                              position
                            ) : (
                              <LockKeyhole size={14} />
                            )}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onSelect(lesson.id)}
                          aria-current={isSelected ? "true" : undefined}
                          className="member-playlist__lesson-button"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <LessonThumbnail src={thumbnailUrlByLessonId?.get(lesson.id)} />
                            <span className="min-w-0">
                              <span className="member-playlist__lesson-title">{lesson.title}</span>
                              <span className="member-playlist__lesson-meta">
                                {lesson.duration}
                                {isCompleted ? " · Completed" : ""}
                                {!unlocked ? " · Locked" : ""}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
