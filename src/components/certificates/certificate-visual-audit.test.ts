import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = ts.createSourceFile(
  "check-certificate-visual.mjs",
  readFileSync(join(process.cwd(), "scripts/check-certificate-visual.mjs"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const declaration = source.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((item) => ts.isIdentifier(item.name) && item.name.text === "audit");
if (!declaration?.initializer || !ts.isNoSubstitutionTemplateLiteral(declaration.initializer)) {
  throw new Error("Certificate browser audit script missing");
}
const audit = declaration.initializer.text;

function startAudit(images: { complete: boolean; naturalWidth: number; decode: () => Promise<void> }[]) {
  let onLoad!: () => Promise<void>;
  const output = { id: "", hidden: false, textContent: "" };
  const document = {
    createElement: () => output,
    body: { append: () => {} },
    fonts: Object.assign([], { ready: Promise.resolve() }),
    images,
    documentElement: { scrollWidth: 390 },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  new Function("addEventListener", "document", "innerWidth", "getComputedStyle", audit)(
    (_event: string, handler: () => Promise<void>) => { onLoad = handler; },
    document,
    390,
    () => ({ getPropertyValue: () => "" }),
  );
  return { output, done: onLoad() };
}

describe("certificate browser audit image readiness", () => {
  it("waits for a delayed image instead of freezing a false failure", async () => {
    let finish!: () => void;
    const image = { complete: false, naturalWidth: 0, decode: () => new Promise<void>((resolve) => { finish = resolve; }) };
    const { output, done } = startAudit([image]);
    await Promise.resolve();
    expect(output.textContent).toBe("");
    image.complete = true;
    image.naturalWidth = 300;
    finish();
    await done;
    expect(JSON.parse(output.textContent).images).toBe(true);
  });

  it("reports a broken image instead of treating it as ready", async () => {
    const { output, done } = startAudit([{ complete: true, naturalWidth: 0, decode: async () => { throw new Error("Image decode failed"); } }]);
    await done;
    expect(JSON.parse(output.textContent)).toEqual({ error: "Image decode failed" });
  });

  it("finishes fixtures without images", async () => {
    const { output, done } = startAudit([]);
    await done;
    expect(JSON.parse(output.textContent).images).toBe(true);
  });
});
