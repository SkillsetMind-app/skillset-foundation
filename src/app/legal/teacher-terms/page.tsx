import { LegalArticle, LegalSection, LegalText } from "@/components/site/legal-article";
import { refundWindowDays } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("legalPages.teacherTerms.title"),
    description: t("legalPages.teacherTerms.description"),
    path: "/legal/teacher-terms",
  });
}

export default async function TeacherTermsPage() {
  const { t } = await getServerTranslation();
  return (
    <LegalArticle
      kicker={t("legalPages.common.kicker")}
      title={t("legalPages.teacherTerms.title")}
      effectiveDate={t("legalPages.common.effectiveDate")}
      effectiveLabel={t("legalPages.common.effectiveLabel")}
      intro={
        <>
          <p>
            <LegalText text={t("legalPages.teacherTerms.text1")} />
          </p>
          <p className="mt-3">
            <LegalText text={t("legalPages.teacherTerms.text2")} />
          </p>
        </>
      }
    >
      <LegalSection heading={t("legalPages.teacherTerms.heading1")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text3")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading2")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text4")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading3")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text5")} />
        </p>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text6")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading4")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text7")} />
        </p>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text8")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading5")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text9")} />
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <LegalText text={t("legalPages.teacherTerms.text10")} />
          </li>
          <li>
            <LegalText text={t("legalPages.teacherTerms.text11")} />
          </li>
          <li>
            <LegalText text={t("legalPages.teacherTerms.text12")} />
          </li>
          <li>
            <LegalText text={t("legalPages.teacherTerms.text13")} />
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading6")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text14")} />
        </p>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text15")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading7")}>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <LegalText text={t("legalPages.teacherTerms.text16")} />
          </li>
          <li>
            <LegalText text={t("legalPages.teacherTerms.text17")} />
          </li>
          <li>
            <LegalText text={t("legalPages.teacherTerms.text18")} />
          </li>
          <li>
            <LegalText text={t("legalPages.teacherTerms.text19")} />
          </li>
          <li>
            <LegalText text={t("legalPages.teacherTerms.text20").replaceAll("{days}", () => String(refundWindowDays))} />
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading8")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text21")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading9")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text22")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading10")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text23")} />
        </p>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text24")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading11")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text25")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.teacherTerms.heading12")}>
        <p>
          <LegalText text={t("legalPages.teacherTerms.text26")} />
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
