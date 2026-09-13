import { LegalArticle, LegalSection, LegalText } from "@/components/site/legal-article";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("legalPages.privacy.title"),
    description: t("legalPages.privacy.description"),
    path: "/legal/privacy",
  });
}

export default async function PrivacyPage() {
  const { t } = await getServerTranslation();
  return (
    <LegalArticle
      kicker={t("legalPages.common.kicker")}
      title={t("legalPages.privacy.title")}
      effectiveDate={t("legalPages.common.effectiveDate")}
      effectiveLabel={t("legalPages.common.effectiveLabel")}
      intro={
        <>
          <p>
            <LegalText text={t("legalPages.privacy.text1")} />
          </p>
          <p className="mt-3">
            <LegalText text={t("legalPages.privacy.text2")} />
          </p>
        </>
      }
    >
      <LegalSection heading={t("legalPages.privacy.heading1")}>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <LegalText text={t("legalPages.privacy.text3")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text4")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text5")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text6")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text7")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text8")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text9")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text10")} />
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading2")}>
        <p>
          <LegalText text={t("legalPages.privacy.text11")} />
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <LegalText text={t("legalPages.privacy.text12")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text13")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text14")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text15")} />
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading3")}>
        <p>
          <LegalText text={t("legalPages.privacy.text16")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading4")}>
        <p>
          <LegalText text={t("legalPages.privacy.text17")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading5")}>
        <p>
          <LegalText text={t("legalPages.privacy.text18")} />
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <LegalText text={t("legalPages.privacy.text19")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text20")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text21")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text22")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text23")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text24")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text25")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text26")} />
          </li>
        </ul>
        <p>
          <LegalText text={t("legalPages.privacy.text27")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading6")}>
        <p>
          <LegalText text={t("legalPages.privacy.text28")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading7")}>
        <p>
          <LegalText text={t("legalPages.privacy.text29")} />
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <LegalText text={t("legalPages.privacy.text30")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text31")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text32")} />
          </li>
          <li>
            <LegalText text={t("legalPages.privacy.text33")} />
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading8")}>
        <p>
          <LegalText text={t("legalPages.privacy.text34")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading9")}>
        <p>
          <LegalText text={t("legalPages.privacy.text35")} />
        </p>
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            <LegalText text={t("legalPages.privacy.text36")} />
          </h3>
          <p className="mt-2">
            <LegalText text={t("legalPages.privacy.text37")} />
          </p>
        </div>
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            <LegalText text={t("legalPages.privacy.text38")} />
          </h3>
          <p className="mt-2">
            <LegalText text={t("legalPages.privacy.text39")} />
          </p>
        </div>
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            <LegalText text={t("legalPages.privacy.text40")} />
          </h3>
          <p className="mt-2">
            <LegalText text={t("legalPages.privacy.text41")} />
          </p>
        </div>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading10")}>
        <p>
          <LegalText text={t("legalPages.privacy.text42")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading11")}>
        <p>
          <LegalText text={t("legalPages.privacy.text43")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.privacy.heading12")}>
        <p>
          <LegalText text={t("legalPages.privacy.text44")} />
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
