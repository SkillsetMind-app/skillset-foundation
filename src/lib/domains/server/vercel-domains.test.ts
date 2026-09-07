import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  add: vi.fn(),
  verify: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));

// Keep the domain boundary real; only Vercel's external operations are replaced.
vi.mock("@vercel/sdk/funcs/projectsAddProjectDomain.js", () => ({ projectsAddProjectDomain: sdk.add }));
vi.mock("@vercel/sdk/funcs/projectsVerifyProjectDomain.js", () => ({ projectsVerifyProjectDomain: sdk.verify }));
vi.mock("@vercel/sdk/funcs/projectsGetProjectDomain.js", () => ({ projectsGetProjectDomain: sdk.get }));
vi.mock("@vercel/sdk/funcs/projectsRemoveProjectDomain.js", () => ({ projectsRemoveProjectDomain: sdk.remove }));

import {
  addDomainToProject,
  refreshDomainStatus,
  removeDomainFromProject,
  type VercelDomainsConfig,
} from "@/lib/domains/server/vercel-domains";

const config: VercelDomainsConfig = {
  apiCredential: "test-only",
  projectId: "test-project",
  teamId: "test-team",
};

describe.each([
  ["add", addDomainToProject, sdk.add],
  ["refresh", refreshDomainStatus, sdk.verify],
  ["remove", removeDomainFromProject, sdk.remove],
] as const)("custom domain %s", (operation, run, upstream) => {
  beforeEach(() => {
    for (const call of Object.values(sdk)) {
      call.mockReset().mockResolvedValue({ ok: true, value: { verified: true } });
    }
  });

  it.each([
    "skillsetmind.com",
    "WWW.SkillsetMind.com",
    "preview.vercel.app",
    "teacher.example/path",
  ])("refuses stored hostname %s before contacting Vercel", async (hostname) => {
    // A caller can create a row through PostgREST without the POST route's parser.
    const result = await run(hostname, config);

    expect(result).toMatchObject(operation === "remove" ? { ok: false } : { status: "error" });
    for (const call of Object.values(sdk)) expect(call).not.toHaveBeenCalled();
  });

  it("keeps a valid creator hostname working", async () => {
    const result = await run("teacher.example", config);

    expect(result).toMatchObject(operation === "remove" ? { ok: true } : { status: "active" });
    expect(upstream).toHaveBeenCalledOnce();
    expect(upstream).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(
      operation === "add" ? { requestBody: { name: "teacher.example" } } : { domain: "teacher.example" },
    ));
  });
});
