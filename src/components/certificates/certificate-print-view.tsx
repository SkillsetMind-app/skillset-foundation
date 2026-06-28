"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { CertificateDocument } from "@/components/certificates/certificate-document";
import type { Certificate } from "@/domain/certificate";
import { getCertificate } from "@/lib/data/certificates";
import { SITE_URL } from "@/lib/seo/page-metadata";

type LoadState = "loading" | "ready" | "missing" | "error";

export function CertificatePrintView({
  certificateId,
}: {
  certificateId: string;
}) {
  const { user } = useAuth();
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    // ProtectedSurface only mounts this view for a signed-in account with the
    // certificates.view permission, so `user` is normally present. Guard the
    // async fetch anyway and never set state synchronously in the effect body.
    if (!user) {
      return;
    }

    let active = true;

    getCertificate(certificateId)
      .then((result) => {
        if (!active) {
          return;
        }

        if (result && result.userId === user.uid && result.status === "issued") {
          setCertificate(result);
          setState("ready");
        } else {
          setState("missing");
        }
      })
      .catch(() => {
        if (active) {
          setState("error");
        }
      });

    return () => {
      active = false;
    };
  }, [certificateId, user]);

  return (
    <main className="min-h-screen bg-[var(--color-surface)] px-5 py-10 sm:px-8 print:bg-white print:p-0">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/learn/credentials"
          className="text-sm font-semibold text-[var(--color-primary)] underline underline-offset-2"
        >
          ← Back to credentials
        </Link>
        {state === "ready" && certificate ? (
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={buildLinkedInAddUrl(certificate)}
              target="_blank"
              rel="noopener noreferrer"
              className="button-outline px-4 py-2.5 text-sm"
            >
              Add to LinkedIn
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="button-solid px-4 py-2.5 text-sm"
            >
              Download PDF
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-6 print:mt-0">
        {state === "loading" ? (
          <CertificateNotice
            title="Preparing your certificate..."
            description="Skillset is loading this credential record."
          />
        ) : null}

        {state === "ready" && certificate ? (
          <CertificateDocument certificate={certificate} />
        ) : null}

        {state === "missing" ? (
          <CertificateNotice
            title="Certificate not available."
            description="This certificate could not be found on your account, or it has not been issued yet. Issue it from your credentials page first."
          />
        ) : null}

        {state === "error" ? (
          <CertificateNotice
            title="We could not load this certificate."
            description="Something went wrong loading the credential. Refresh the page or try again from your credentials list."
          />
        ) : null}
      </div>
    </main>
  );
}

// LinkedIn "Add to Profile" deep link for the Licenses & Certifications section.
// Points at the public verification URL so anyone (recruiters included) can confirm it.
function buildLinkedInAddUrl(certificate: Certificate): string {
  const verifyUrl = `${SITE_URL}/verify?code=${encodeURIComponent(
    certificate.verificationCode,
  )}`;

  const params = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: certificate.courseTitle,
    organizationName: "Skillset",
    certUrl: verifyUrl,
    certId: certificate.verificationCode,
  });

  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

function CertificateNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="mx-auto max-w-2xl rounded-[18px] border border-[var(--color-line)] bg-white p-6 text-center shadow-[var(--shadow-soft)] sm:p-8">
      <h1 className="display-title text-3xl text-[var(--color-primary)]">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
        {description}
      </p>
    </section>
  );
}
