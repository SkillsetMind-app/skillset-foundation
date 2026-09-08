import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportTableButton } from "@/components/shared/export-table-button";
import { I18nProvider } from "@/components/i18n/i18n-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
  locale: "en" | "es" = "en",
) {
  render(<I18nProvider initialLocale={locale}><ExportTableButton rows={rows} filename="local-fixtures" /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: locale === "es" ? "Exportar" : "Export" }));
  fireEvent.click(screen.getByRole("menuitem", { name: locale === "es" ? `Exportar como ${format}` : `Export as ${format}` }));

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

  it.each(["CSV", "JSON"] as const)("translates only the controls, preserving the %s payload in Spanish", async format => {
    const rows = [{ message: "=1+1", name: 'Álvarez $$ $& "literal"', amount: -12.5 }];
    const text = await exportText(rows, format, "es");
    expect(text).toBe(format === "JSON" ? JSON.stringify(rows, null, 2) : 'message,name,amount\n"\t=1+1","Álvarez $$ $& ""literal""",-12.5');
  });
});

describe("menu de exportacao dentro da tela", () => {
  let anchor: DOMRect;
  let menuHeight: number;
  let onResize: ResizeObserverCallback;
  const disconnect = vi.fn();

  beforeEach(() => {
    anchor = new DOMRect(45, 420, 112, 44);
    menuHeight = 142;
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { onResize = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    disconnect.mockClear();
    // jsdom nao faz layout: fornecemos apenas as medidas, como no Tooltip.
    // Posicao, limites e listeners continuam sendo os do componente real.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "menu") {
        return new DOMRect(0, 0,
          Math.min(176, Number.parseFloat(this.style.maxWidth) || 176),
          Math.min(menuHeight, Number.parseFloat(this.style.maxHeight) || menuHeight),
        );
      }
      return this.getAttribute("aria-haspopup") === "menu" ? anchor : new DOMRect();
    });
  });

  function openMenu() {
    const trigger = screen.getByRole("button", { name: "Export" });
    fireEvent.click(trigger);
    return { trigger, menu: screen.getByRole("menu") };
  }

  it.each([320, 390, 768, 1440].flatMap(width => [
    { width, side: "esquerda", x: 4 },
    { width, side: "direita", x: width - 116 },
  ]))("cabe junto a borda $side em $width px e sai de ancestrais que recortam", ({ width, x }) => {
    vi.stubGlobal("innerWidth", width);
    anchor = new DOMRect(x, 100, 112, 44);
    const { container } = render(<div style={{ overflow: "hidden", height: 44 }}>
      <ExportTableButton rows={[{ id: "fixture" }]} filename="fixture" />
    </div>);
    const { menu } = openMenu();
    const left = Number.parseFloat(menu.style.left);
    const top = Number.parseFloat(menu.style.top);

    expect(container).not.toContainElement(menu);
    expect(menu.style.position).toBe("fixed");
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 176).toBeLessThanOrEqual(width - 8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + menuHeight).toBeLessThanOrEqual(844 - 8);
  });

  it("abre acima do gatilho perto da borda inferior", () => {
    anchor = new DOMRect(45, 780, 112, 44);
    render(<ExportTableButton rows={[{ id: "fixture" }]} filename="fixture" />);
    const { menu } = openMenu();
    expect(Number.parseFloat(menu.style.top) + menuHeight).toBeLessThanOrEqual(anchor.top - 8);
  });

  it("acompanha resize aberto, rolagem e mudanca de tamanho, e remove observadores", () => {
    vi.stubGlobal("innerWidth", 1440);
    anchor = new DOMRect(1300, 600, 112, 44);
    const { container, unmount } = render(<div>
      <ExportTableButton rows={[{ id: "fixture" }]} filename="fixture" />
    </div>);
    const { menu } = openMenu();
    vi.stubGlobal("innerWidth", 320);
    anchor = new DOMRect(200, 600, 112, 44);
    fireEvent.resize(window);
    expect(Number.parseFloat(menu.style.left) + 176).toBeLessThanOrEqual(312);

    anchor = new DOMRect(4, 300, 112, 44);
    fireEvent.scroll(container);
    expect(Number.parseFloat(menu.style.left)).toBe(8);
    expect(Number.parseFloat(menu.style.top)).toBe(352);

    menuHeight = 300;
    anchor = new DOMRect(4, 780, 112, 44);
    act(() => onResize([], {} as ResizeObserver));
    expect(Number.parseFloat(menu.style.top) + menuHeight).toBeLessThanOrEqual(772);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockClear();
    fireEvent.resize(window);
    fireEvent.scroll(container);
    expect(HTMLElement.prototype.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it("limita o painel ao viewport visual menor e acompanha seus eventos", () => {
    const viewport = Object.assign(new EventTarget(), { width: 160, height: 100, offsetLeft: 10, offsetTop: 20 });
    vi.stubGlobal("visualViewport", viewport);
    anchor = new DOMRect(70, 50, 80, 44);
    render(<ExportTableButton rows={[{ id: "fixture" }]} filename="fixture" />);
    const { menu } = openMenu();

    expect(menu.style.maxWidth).toBe("144px");
    expect(menu.style.maxHeight).toBe("84px");
    expect(Number.parseFloat(menu.style.left)).toBe(18);
    expect(Number.parseFloat(menu.style.top)).toBe(28);
    viewport.offsetLeft = 30;
    act(() => viewport.dispatchEvent(new Event("scroll")));
    expect(Number.parseFloat(menu.style.left)).toBe(38);
    viewport.height = 220;
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect(menu.style.maxHeight).toBe("204px");
  });

  it("Escape fecha somente o menu ativo e devolve foco ao botao de exportar", () => {
    const outerEscape = vi.fn();
    render(<div onKeyDown={outerEscape}>
      <ExportTableButton rows={[{ id: "fixture" }]} filename="fixture" />
    </div>);
    const { trigger, menu } = openMenu();
    const first = screen.getByRole("menuitem", { name: "Export as CSV" });
    expect(first).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(menu).toHaveAccessibleName("Export");

    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(outerEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(outerEscape).toHaveBeenCalledOnce();
  });

  it("move foco pelas opcoes com setas, Home e End; Tab sai sem prender a pessoa", () => {
    render(<ExportTableButton rows={[{ id: "fixture" }]} filename="fixture" />);
    const { trigger } = openMenu();
    const first = screen.getByRole("menuitem", { name: "Export as CSV" });
    const last = screen.getByRole("menuitem", { name: "Export as JSON" });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(last).toHaveFocus();
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("clique fora fecha sem roubar foco, mas clicar dentro preserva as opcoes", () => {
    render(<>
      <ExportTableButton rows={[{ id: "fixture" }]} filename="fixture" />
      <button>Other action</button>
    </>);
    openMenu();
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Export as CSV" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const outside = screen.getByRole("button", { name: "Other action" });
    act(() => outside.focus());
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("fecha apos baixar e devolve o foco ao gatilho", async () => {
    await exportText([{ id: "fixture" }]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });

  it.each([
    { rows: [], disabled: false },
    { rows: [{ id: "fixture" }], disabled: true },
  ])("mantem exportacao indisponivel quando rows=$rows e disabled=$disabled", props => {
    render(<ExportTableButton {...props} filename="fixture" />);
    const trigger = screen.getByRole("button", { name: "Export" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
