import { LegalArticle, LegalSection, LegalText } from "@/components/site/legal-article";
import { refundWindowDays } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("legalPages.terms.title"),
    description: t("legalPages.terms.description"),
    path: "/legal/terms",
  });
}

export default async function TermsPage() {
  const { t } = await getServerTranslation();
  return (
    <LegalArticle
      kicker={t("legalPages.common.kicker")}
      title={t("legalPages.terms.title")}
      effectiveDate={t("legalPages.common.effectiveDate")}
      effectiveLabel={t("legalPages.common.effectiveLabel")}
      intro={
        <>
          <p>
            <LegalText text={t("legalPages.terms.text1")} />
          </p>
          <p className="mt-3">
            <LegalText text={t("legalPages.terms.text2")} />
          </p>
        </>
      }
    >
      <LegalSection heading={t("legalPages.terms.heading1")}>
        <p>
          <LegalText text={t("legalPages.terms.text3")} />
        </p>
        <p>
          <LegalText text={t("legalPages.terms.text4")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading2")}>
        <p>
          <LegalText text={t("legalPages.terms.text5")} />
        </p>
        <p>
          <LegalText text={t("legalPages.terms.text6")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading3")}>
        <p>
          <LegalText text={t("legalPages.terms.text7")} />
        </p>
        <p>
          <LegalText text={t("legalPages.terms.text8")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading4")}>
        <p>
          <LegalText text={t("legalPages.terms.text9")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading5")}>
        <p>
          <LegalText text={t("legalPages.terms.text10")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading6")}>
        <p>
          <LegalText text={t("legalPages.terms.text11")} />
        </p>
        <p>
          <LegalText text={t("legalPages.terms.text12")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading7")}>
        <p>
          <LegalText text={t("legalPages.terms.text13").replaceAll("{days}", () => String(refundWindowDays))} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading8")}>
        <p>
          <LegalText text={t("legalPages.terms.text14")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading9")}>
        <p>
          <LegalText text={t("legalPages.terms.text15")} />
        </p>
        <p>
          <LegalText text={t("legalPages.terms.text16")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading10")}>
        <p>
          <LegalText text={t("legalPages.terms.text17")} />
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <LegalText text={t("legalPages.terms.text18")} />
          </li>
          <li>
            <LegalText text={t("legalPages.terms.text19")} />
          </li>
          <li>
            <LegalText text={t("legalPages.terms.text20")} />
          </li>
          <li>
            <LegalText text={t("legalPages.terms.text21")} />
          </li>
          <li>
            <LegalText text={t("legalPages.terms.text22")} />
          </li>
          <li>
            <LegalText text={t("legalPages.terms.text23")} />
          </li>
          <li>
            <LegalText text={t("legalPages.terms.text24")} />
          </li>
          <li>
            <LegalText text={t("legalPages.terms.text25")} />
          </li>
        </ul>
        <p>
          <LegalText text={t("legalPages.terms.text26")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading11")}>
        <p>
          <LegalText text={t("legalPages.terms.text27")} />
        </p>
        <p>
          <LegalText text={t("legalPages.terms.text28")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading12")}>
        <p>
          <LegalText text={t("legalPages.terms.text29")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading13")}>
        <p>
          <LegalText text={t("legalPages.terms.text30")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading14")}>
        <p>
          <LegalText text={t("legalPages.terms.text31")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading15")}>
        <p>
          <LegalText text={t("legalPages.terms.text32")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading16")}>
        <p>
          <LegalText text={t("legalPages.terms.text33")} />
        </p>
        <p>
          <LegalText text={t("legalPages.terms.text34")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading17")}>
        <p>
          <LegalText text={t("legalPages.terms.text35")} />
        </p>
        <p>
          <LegalText text={t("legalPages.terms.text36")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.terms.heading18")}>
        <p>
          <LegalText text={t("legalPages.terms.text37")} />
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
