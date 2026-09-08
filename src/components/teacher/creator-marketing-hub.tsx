"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BadgePercent,
  ExternalLink,
  Image,
  MessageCircle,
  Plug,
  Store,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Card, buttonClasses } from "@/components/ui";
import { groupCourseMessageThreads } from "@/domain/course-message";
import type { CourseMessage } from "@/domain/course-message";
import type { TeacherCourse } from "@/domain/teacher-course";
import { instructorPagePath } from "@/domain/user-profile";
import { countCourseAssets } from "@/lib/data/course-assets";
import { subscribeToTeacherMessages } from "@/lib/data/course-messages";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

// O que a pessoa sofria: esta era a tela mais crua do painel — cinco linhas de
// lista com um botao cada e nenhum estado. O professor abria Marketing e nao
// sabia se a vitrine estava no ar, quantas mensagens esperavam resposta nem
// quantos arquivos tinha na midia; precisava entrar em cada tela para
// descobrir. Agora cada cartao responde a pergunta antes do clique, com dado
// que ja existe (nenhuma consulta nova de servidor foi criada para isto).

type ToolCard = {
  key: string;
  title: string;
  description: string;
  href: string;
  action: string;
  icon: LucideIcon;
  /** Linha de estado do cartao. `null` quando o dado nao existe barato. */
  state: ReactNode;
};

export function CreatorMarketingHub() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const uid = user?.uid ?? "";

  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [messages, setMessages] = useState<CourseMessage[] | null>(null);
  const [mediaFiles, setMediaFiles] = useState<number | null>(null);

  // Dependencia no uid (string) e nao no objeto do usuario: um objeto novo a
  // cada render reinscreveria os efeitos em laco.
  useEffect(() => {
    if (!uid) {
      return;
    }

    return subscribeToTeacherCourses(
      uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setCoursesLoaded(true);
      },
      () => {
        setCoursesLoaded(true);
      },
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      return;
    }

    return subscribeToTeacherMessages(
      uid,
      setMessages,
      // Sem mensagens carregadas o cartao mostra so o botao: numero errado e
      // pior que numero nenhum.
      () => setMessages(null),
    );
  }, [uid]);

  // A chave em texto evita refazer a contagem a cada render por causa da
  // identidade nova do array vindo da inscricao.
  const courseIdsKey = courses.map((course) => course.id).join(",");

  useEffect(() => {
    if (!uid || !coursesLoaded) {
      return;
    }

    let mounted = true;
    countCourseAssets(courseIdsKey ? courseIdsKey.split(",") : [])
      .then((count) => {
        if (mounted) {
          setMediaFiles(count);
        }
      })
      .catch(() => {
        if (mounted) {
          setMediaFiles(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, [uid, coursesLoaded, courseIdsKey]);

  const publishedCount = courses.filter(
    (course) => course.status === "published",
  ).length;
  // A vitrine existe sempre; o que muda e ter algo publicado nela. Dizer "no
  // ar" com zero curso seria mentira, e e a mesma regra do cartao da Home.
  const isPublished = publishedCount > 0;

  const awaitingReply = useMemo(() => {
    if (messages === null) {
      return null;
    }

    return groupCourseMessageThreads(messages).filter(
      (thread) => thread.lastMessage.senderId !== uid,
    ).length;
  }, [messages, uid]);

  const tools: ToolCard[] = [
    {
      key: "storefront",
      title: t("teach.marketing.storefront.title"),
      description: t("teach.marketing.storefront.description"),
      href: "/teach/storefront",
      action: t("teach.marketing.storefront.action"),
      icon: Store,
      state: !coursesLoaded ? (
        <span className="text-xs text-[var(--color-ink-muted)]">
          {t("teach.marketing.checking")}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={`status-chip ${isPublished ? "status-chip--success" : "status-chip--draft"}`}
          >
            <span className="status-chip__dot" aria-hidden="true" />
            {t(
              isPublished
                ? "teach.marketing.state.published"
                : "teach.marketing.state.notPublished",
            )}
          </span>
          {uid ? (
            <Link
              href={instructorPagePath(uid)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] underline underline-offset-2"
            >
              {t("teach.marketing.state.openPublicPage")}
              <ExternalLink aria-hidden="true" size={12} strokeWidth={1.9} />
              <span className="sr-only">{t("platform.opensInNewTab")}</span>
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      key: "media",
      title: t("teach.marketing.media.title"),
      description: t("teach.marketing.media.description"),
      href: "/teach/media",
      action: t("teach.marketing.media.action"),
      icon: Image,
      state:
        mediaFiles === null ? null : (
          <span className="text-xs font-semibold tabular-nums text-[var(--color-ink-soft)]">
            {t(
              mediaFiles === 1
                ? "teach.marketing.state.filesOne"
                : "teach.marketing.state.filesMany",
            ).replace("{count}", String(mediaFiles))}
          </span>
        ),
    },
    {
      key: "messages",
      title: t("teach.marketing.messages.title"),
      description: t("teach.marketing.messages.description"),
      href: "/teach/messages",
      action: t("teach.marketing.messages.action"),
      icon: MessageCircle,
      state:
        awaitingReply === null ? null : (
          <span className="text-xs font-semibold tabular-nums text-[var(--color-ink-soft)]">
            {awaitingReply === 0
              ? t("teach.marketing.state.noAwaitingReply")
              : t(
                  awaitingReply === 1
                    ? "teach.marketing.state.awaitingReplyOne"
                    : "teach.marketing.state.awaitingReplyMany",
                ).replace("{count}", String(awaitingReply))}
          </span>
        ),
    },
    {
      key: "coupons",
      title: t("teach.marketing.coupons.title"),
      description: t("teach.marketing.coupons.description"),
      href: "/teach/coupons",
      action: t("teach.marketing.coupons.action"),
      icon: BadgePercent,
      // Cupom mora dentro de cada produto: nao existe cupom "do criador" para
      // contar sem consulta nova. O cartao diz onde o ajuste vive, sem numero.
      state: (
        <span className="text-xs text-[var(--color-ink-soft)]">
          {t("teach.marketing.state.couponsPerProduct")}
        </span>
      ),
    },
    {
      key: "integrations",
      title: t("teach.marketing.integrations.title"),
      description: t("teach.marketing.integrations.description"),
      href: "/teach/integrations",
      action: t("teach.marketing.integrations.action"),
      icon: Plug,
      state: (
        <span className="status-chip status-chip--info">
          {t("teach.marketing.state.planned")}
        </span>
      ),
    },
  ];

  return (
    <div className="grid gap-7">
      <header className="border-b border-[var(--color-line)] pb-5">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
          {t("teach.marketing.eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)]">
          {t("teach.marketing.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("teach.marketing.description")}
        </p>
      </header>

      <section aria-labelledby="marketing-tools-title">
        {/* O "5 tools" saiu: a grade ja diz quantos sao, e o espaco vale mais
            para o estado de cada cartao. */}
        <h2 id="marketing-tools-title" className="text-lg font-semibold text-[var(--color-ink)]">
          {t("teach.marketing.sectionTitle")}
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;

            return (
              <Card
                key={tool.key}
                as="article"
                padding="md"
                className="grid content-start gap-3"
              >
                <span className="grid size-10 place-items-center rounded-[7px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">{tool.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
                    {tool.description}
                  </p>
                </div>
                {tool.state ? <div>{tool.state}</div> : null}
                <Link
                  href={tool.href}
                  className={`${buttonClasses({ variant: "outline", size: "sm" })} justify-self-start`}
                >
                  {tool.action}
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
                </Link>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
