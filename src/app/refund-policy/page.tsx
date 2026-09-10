import { LegalArticle, LegalSection, LegalText } from "@/components/site/legal-article";
import { refundWindowDays } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("legalPages.refund.title"),
    description: t("legalPages.refund.description").replaceAll("{days}", () => String(refundWindowDays)),
    path: "/refund-policy",
  });
}

export default async function RefundPolicyPage() {
  const { t } = await getServerTranslation();
  return (
    <LegalArticle
      kicker={t("legalPages.common.kicker")}
      title={t("legalPages.refund.title")}
      effectiveDate={t("legalPages.common.effectiveDate")}
      effectiveLabel={t("legalPages.common.effectiveLabel")}
      intro={
        <>
          <p>
            <LegalText text={t("legalPages.refund.text1")} />
          </p>
          <p className="mt-3">
            <LegalText text={t("legalPages.refund.text2").replaceAll("{days}", () => String(refundWindowDays))} />
          </p>
        </>
      }
    >
      <LegalSection heading={t("legalPages.refund.heading1").replaceAll("{days}", () => String(refundWindowDays))}>
        <p>
          <LegalText text={t("legalPages.refund.text3").replaceAll("{days}", () => String(refundWindowDays))} />
        </p>
        <p>
          <LegalText text={t("legalPages.refund.text4")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.refund.heading2")}>
        <p>
          <LegalText text={t("legalPages.refund.text5")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.refund.heading3")}>
        <p>
          <LegalText text={t("legalPages.refund.text6")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.refund.heading4")}>
        <p>
          <LegalText text={t("legalPages.refund.text7").replaceAll("{days}", () => String(refundWindowDays))} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.refund.heading5")}>
        <p>
          <LegalText text={t("legalPages.refund.text8")} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.refund.heading6")}>
        <p>
          <LegalText text={t("legalPages.refund.text9").replaceAll("{days}", () => String(refundWindowDays))} />
        </p>
      </LegalSection>

      <LegalSection heading={t("legalPages.refund.heading7")}>
        <p>
          <LegalText text={t("legalPages.refund.text10")} />
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
