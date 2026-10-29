import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { CertificateDocument } from "@/components/certificates/certificate-document";
import { VerifiedSeal } from "@/components/shared/verified-badge";
import type { Certificate } from "@/domain/certificate";

afterEach(cleanup);

const certificate: Certificate = {
  id: "synthetic-certificate", enrollmentId: "synthetic-enrollment", userId: "synthetic-user",
  courseId: "synthetic-course", courseSlug: "synthetic-course",
  courseTitle: "Emotional Intelligence: Foundations and Practice", courseCategory: "Personal development",
  authorityLabel: "SkillsetMind Verified", status: "issued", verificationCode: "SK-SYNTHETIC-ONLY",
  studentFullName: "Alex Morgan", teacherName: "Taylor Rivera",
  teacherSignatureUrl: "/synthetic-signature.png", sponsorLogoUrl: "/synthetic-logo.png",
  issuedAt: "2026-10-28T00:30:00Z",
};

function show(overrides: Partial<Certificate> = {}) {
  return render(<CertificateDocument certificate={{ ...certificate, ...overrides }} />);
}

describe("certificate document snapshot", () => {
  it("preserves the learner, course, authority, signature, logo and verification code", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(certificate.studentFullName!);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(certificate.courseTitle);
    expect(screen.getByText(certificate.authorityLabel)).toBeInTheDocument();
    expect(screen.getByAltText("Taylor Rivera signature")).toHaveAttribute("src", certificate.teacherSignatureUrl);
    expect(screen.getByAltText("Taylor Rivera")).toHaveAttribute("src", certificate.sponsorLogoUrl);
    expect(screen.getByAltText("SkillsetMind")).toBeInTheDocument();
    expect(screen.getByAltText("SkillsetMind")).toHaveAttribute("src", "/brand/logo-full-navy.svg");
    expect(screen.getByText(certificate.verificationCode)).toBeInTheDocument();
    expect(screen.getByText("Verify at skillsetmind.com/verify")).toBeInTheDocument();
  });

  it("retains the white-label snapshot without restoring platform branding", () => {
    show({ hidePlatformBrand: true });
    expect(screen.queryByAltText("SkillsetMind")).toBeNull();
    expect(screen.queryByText(certificate.authorityLabel)).toBeNull();
    expect(screen.getByAltText("Taylor Rivera")).toBeInTheDocument();
    expect(screen.getByText("has successfully completed the program")).toBeInTheDocument();
    expect(screen.getByText(certificate.verificationCode)).toBeInTheDocument();
    expect(screen.getByText("Verify at skillsetmind.com/verify")).toBeInTheDocument();
  });

  it("keeps readable fallbacks when a white-label snapshot has no images or names", () => {
    show({ hidePlatformBrand: true, studentFullName: " ", teacherName: null, sponsorLogoUrl: null, teacherSignatureUrl: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Learner");
    expect(screen.getAllByText("Instructor").length).toBeGreaterThan(1);
    expect(screen.queryByAltText("SkillsetMind")).toBeNull();
  });

  it.each(["A".repeat(120), "Alexandra Morgan ".repeat(7).padEnd(120, "X")])(
    "retains all 120 characters without truncation or a no-wrap class (%s)", (name) => {
      const title = "Professional practice and emotional intelligence ".repeat(6);
      show({ studentFullName: name, courseTitle: title });
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe(name);
      expect(heading).toHaveClass("cert-doc-name-long");
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(title);
      expect(screen.getByRole("heading", { level: 2 })).toHaveClass("cert-doc-course-long");
      expect(heading.className).not.toMatch(/truncate|nowrap|line-clamp/);
    },
  );

  it.each([
    "2026-10-28T00:30:00Z",
    "2026-10-27T20:30:00-04:00",
    new Date("2026-10-28T00:30:00Z"),
    { toDate: () => new Date("2026-10-28T00:30:00Z") },
  ])("formats the issue date in UTC, including timestamp snapshots (%s)", (issuedAt) => {
    show({ issuedAt });
    expect(screen.getByText("Issued October 28, 2026")).toBeInTheDocument();
  });

  it.each([null, "not-a-date", { toDate: () => { throw new Error("invalid snapshot"); } }])(
    "does not invent a date for an invalid snapshot (%s)", (issuedAt) => {
      show({ issuedAt });
      expect(screen.queryByText(/^Issued /)).toBeNull();
      expect(screen.getByText(certificate.verificationCode)).toBeInTheDocument();
    },
  );
});

describe("document presentation contract (not browser layout proof)", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const documentCss = css.slice(css.indexOf("/* Document palette"), css.indexOf("/* === Members area"));

  it("uses a fixed light document palette rather than theme tokens", () => {
    expect(documentCss).toContain("color-scheme: light");
    expect(documentCss).toContain("background: #ffffff");
    expect(documentCss).toContain("--cert-ink: #102a43");
    expect(documentCss).not.toMatch(/var\(--color-/);
    const { container } = show();
    expect(container.innerHTML).not.toMatch(/var\(--color-/);
  });

  it("declares A4 portrait print geometry, wrapping and no truncation", () => {
    expect(documentCss).toContain("size: A4 portrait");
    expect(documentCss).toContain("margin: 12mm");
    expect(documentCss).toContain("overflow-wrap: anywhere");
    expect(documentCss).toContain("minmax(0, 1fr)");
    expect(documentCss).toContain("print-color-adjust: exact");
    expect(documentCss).toContain("html:has(.cert-doc), body:has(.cert-doc)");
    expect(documentCss).not.toMatch(/overflow:\s*hidden|text-overflow|line-clamp/);
  });

  it("exports inspectable synthetic SSR fixtures from the real component and project CSS", async () => {
    const directory = mkdtempSync(join(tmpdir(), "skillsetmind-certificate-ssr-"));
    const logo = `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public/brand/logo-full-navy.svg")).toString("base64")}`;
    const sampleImage = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="#edf2f7"/><text x="15" y="48" font-size="24" fill="#102a43">SYNTHETIC SAMPLE</text></svg>').toString("base64")}`;
    const variants: Record<string, Partial<Certificate>> = {
      standard: {},
      images: { teacherSignatureUrl: sampleImage, sponsorLogoUrl: sampleImage },
      long: { studentFullName: "A".repeat(120), courseTitle: "Emotional intelligence and professional development ".repeat(6) },
      whitelabel: { hidePlatformBrand: true, teacherSignatureUrl: null, sponsorLogoUrl: sampleImage },
    };
    const markups: string[] = [];
    for (const [name, overrides] of Object.entries(variants)) {
      const markup = renderToStaticMarkup(<CertificateDocument certificate={{ ...certificate, teacherSignatureUrl: null, sponsorLogoUrl: null, ...overrides }} />)
        .replace(/srcset="[^"]*"/gi, "")
        .replace(/src="(?:\/_next\/image[^"]*|\/brand\/logo-full-navy\.svg)"/g, `src="${logo}"`);
      expect(markup).toContain("SK-SYNTHETIC-ONLY");
      markups.push(markup);
      for (const theme of ["light", "dark"]) {
        writeFileSync(join(directory, `${name}-${theme}.html`), `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic certificate: ${name}</title><link rel="stylesheet" href="preview.css"></head><body>${markup}</body></html>`);
      }
    }
    const seals = renderToStaticMarkup(<div style={{ padding: 32, display: "flex", flexWrap: "wrap", gap: 24 }}>
      {[12, 14, 16, 24].map((size) => <span key={size} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        Alex Morgan <VerifiedSeal size={size} />
      </span>)}
    </div>);
    markups.push(seals);
    for (const theme of ["light", "dark"]) {
      writeFileSync(join(directory, `seal-${theme}.html`), `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic verified seals</title><link rel="stylesheet" href="preview.css"></head><body>${seals}</body></html>`);
    }
    const require = createRequire(import.meta.url);
    const { compile } = require("@tailwindcss/node");
    const compiler = await compile(css, { base: join(process.cwd(), "src/app"), onDependency() {} });
    const candidates = [...markups.join(" ").matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
    writeFileSync(join(directory, "preview.css"), compiler.build(candidates));
    writeFileSync(join(directory, "README.txt"), "Synthetic SSR of the real CertificateDocument and VerifiedSeal. Platform logo is inlined from the real public asset; no signature is fabricated. preview.css is a fallback without Next-managed fonts. CI browser QA instead serves the actual compiled build CSS and fonts in an isolated runner, checks overflow/image loading and one-page A4 PDFs, and exports PNG/PDF plus visual-report.json. No production route, credentials or customer data are used.\n");
    console.info(`Certificate SSR fixtures: ${directory}`);
  });
});
