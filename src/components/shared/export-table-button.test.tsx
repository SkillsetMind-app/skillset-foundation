import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportTableButton } from "@/components/shared/export-table-button";

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createObjectURL.mockReset().mockReturnValue("blob:local-export");
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function exportText(
  rows: ComponentProps<typeof ExportTableButton>["rows"],
  format: "CSV" | "JSON" = "CSV",
) {
  render(<ExportTableButton rows={rows} filename="local-fixtures" />);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  fireEvent.click(screen.getByRole("menuitem", { name: `Export as ${format}` }));

  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-export");
  const blob = createObjectURL.mock.calls[0][0];
  expect(blob.type).toBe(format === "CSV" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("spreadsheet-safe CSV downloads", () => {
  it.each([
    "=1+1",
    "+1+1",
    "-1+1",
    "@SUM(1,1)",
    "\t=1+1",
    "\r=1+1",
    "\n=1+1",
    " \t=1+1",
    "\u0000=1+1",
    "\uFEFF=1+1",
    "\u00A0=1+1",
    "＝1+1",
    "＋1+1",
    "－1+1",
    "＠SUM(1,1)",
    "+15551234567",
    "-12.5",
  ])("keeps untrusted text %j behind a quoted tab prefix", async (value) => {
    expect(await exportText([{ message: value }])).toBe(`message\n"\t${value}"`);
  });

  it("protects header cells as well as user-provided values", async () => {
    expect(await exportText([{ "=1+1": "safe" }])).toBe('"\t=1+1"\nsafe');
  });

  it("keeps quotes and attempted cell separators inside the protected cell", async () => {
    expect(await exportText([{ message: '=1+1";,=1+1' }])).toBe(
      'message\n"\t=1+1"";,=1+1"',
    );
  });

  it.each(["plain;=1+1", "plain\t=1+1"])("quotes alternate separator text %j", async (value) => {
    expect(await exportText([{ message: value }])).toBe(`message\n"${value}"`);
  });

  it("preserves normal text, numeric values and CSV field boundaries", async () => {
    expect(await exportText([{
      name: "José, Jr.",
      note: 'He said "hello"\nNext line\r\n=1+1 stays in this cell',
      amount: -12.5,
      count: 0,
      active: true,
      inactive: false,
      empty: null,
      absent: undefined,
      literal: "'=1+1",
    }])).toBe(
      'name,note,amount,count,active,inactive,empty,absent,literal\n'
      + '"José, Jr.","He said ""hello""\nNext line\r\n=1+1 stays in this cell",-12.5,0,true,false,,,\'=1+1',
    );
  });

  it("preserves the exact source values in the existing JSON export", async () => {
    const rows = [{ message: '=SUM("1",2)', name: "+15551234567", amount: -12.5 }];
    expect(JSON.parse(await exportText(rows, "JSON"))).toEqual(rows);
  });
});
