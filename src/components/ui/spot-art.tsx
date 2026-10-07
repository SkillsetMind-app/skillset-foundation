import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * As cinco cenas do estúdio, no traço da gravura de cédula que a marca usa no
 * fundo do site (public/brand/hero-engraving-*), mais o selo quadrado do
 * verificado. SVG inline, sem rede: cada cena pesa menos de 3 KB, o que conta
 * para quem abre o estúdio com internet ruim.
 *
 * Regras do desenho (o teste confere as que dá para medir):
 * - traço marinho de 1,25 a 1,5px (`vector-effect` no CSS mantém o px em
 *   qualquer tamanho);
 * - a gravura em elipses e ondas a 15–35% de opacidade;
 * - UM elemento em latão por cena; o resto, quando pede cor, é latão claro;
 * - cantos do token (rx 2 no viewBox ~ raio sm na tela);
 * - sem pessoas, sem dinheiro desenhado, sem número;
 * - `aria-hidden`: o texto ao lado já diz tudo.
 *
 * `tone="light"` é a versão para fundo marinho (coluna da tela de criar).
 */
export type SpotArtScene = "firstProduct" | "firstLesson" | "noStudents" | "noSales" | "published";

export const spotArtScenes: readonly SpotArtScene[] = [
  "firstProduct",
  "firstLesson",
  "noStudents",
  "noSales",
  "published",
];

export type SpotArtProps = {
  scene: SpotArtScene;
  tone?: "default" | "light";
  className?: string;
};

// O tom inteiro mora em 5 variáveis no <svg>; as formas só leem as variáveis.
// No tema escuro, --color-primary e --color-surface já invertem sozinhos.
const tones: Record<NonNullable<SpotArtProps["tone"]>, CSSProperties> = {
  default: {
    color: "var(--color-primary,#102a43)",
    "--art-paper": "var(--color-surface,#fff)",
    "--art-soft": "var(--color-accent-soft,#f4e8ce)",
    "--art-brass": "var(--color-accent,#c99a46)",
    "--art-on-brass": "#091d2f",
  } as CSSProperties,
  light: {
    color: "#fff",
    // Papel opaco, um passo acima do marinho da coluna: a roseta passa por
    // trás do documento, não através dele.
    "--art-paper": "#102a43",
    "--art-soft": "rgba(201,154,70,.24)",
    "--art-brass": "#c99a46",
    "--art-on-brass": "#091d2f",
  } as CSSProperties,
};

/** Roseta de guilhochê: `count` elipses giradas em volta do mesmo centro. */
function rosette(cx: number, cy: number, rx: number, ry: number, count: number) {
  return (
    <g className="spot-art__engraving" opacity=".2" strokeWidth="1.25" transform={`translate(${cx} ${cy})`}>
      {Array.from({ length: count }, (_, index) => (
        <ellipse key={index} rx={rx} ry={ry} transform={`rotate(${Math.round((180 / count) * index)})`} />
      ))}
    </g>
  );
}

/** Ondas de gravura: uma linha por `y`, cada uma com `segments` cristas. */
function waves(x: number, ys: number[], segments: number, opacity = ".3") {
  const d = ys.map((y) => `M${x} ${y}q3-3 6 0${"t6 0".repeat(segments - 1)}`).join("");
  return <path className="spot-art__engraving" d={d} opacity={opacity} strokeWidth="1.25" />;
}

const scenes: Record<SpotArtScene, ReactNode> = {
  // Documento gravado com o selo "+" em latão.
  firstProduct: (
    <>
      {rosette(80, 58, 46, 20, 9)}
      <rect x="54" y="14" width="52" height="72" rx="2" fill="var(--art-paper)" />
      {waves(62, [24, 29], 6)}
      <rect x="62" y="38" width="22" height="3" fill="currentColor" stroke="none" />
      <path d="M62 50h36M62 58h28M62 66h36" opacity=".35" />
      <rect className="spot-art__seal" x="92" y="72" width="22" height="22" rx="2" fill="var(--art-brass)" stroke="none" />
      <path d="M103 77v12M97 83h12" stroke="var(--art-on-brass)" strokeWidth="1.5" />
    </>
  ),
  // Três cartões empilhados; o da frente com o "play" em latão.
  firstLesson: (
    <>
      {waves(28, [100, 105, 110], 17, ".25")}
      <rect x="62" y="16" width="64" height="44" rx="2" fill="var(--art-paper)" opacity=".7" />
      <rect x="50" y="26" width="66" height="46" rx="2" fill="var(--art-paper)" />
      <rect x="36" y="38" width="70" height="48" rx="2" fill="var(--art-paper)" />
      <rect className="spot-art__seal" x="60" y="49" width="22" height="20" rx="2" fill="var(--art-brass)" stroke="none" />
      <path d="M68 54v10l8-5z" fill="var(--art-on-brass)" stroke="none" />
      <path d="M44 78h30" opacity=".35" />
    </>
  ),
  // Grade de lugares tracejados; o primeiro em latão, com "+".
  noStudents: (
    <>
      {waves(26, [14, 19, 24], 18, ".25")}
      <g strokeDasharray="3 3" opacity=".55">
        <rect x="68" y="38" width="24" height="24" rx="2" />
        <rect x="102" y="38" width="24" height="24" rx="2" />
        <rect x="34" y="72" width="24" height="24" rx="2" />
        <rect x="68" y="72" width="24" height="24" rx="2" />
        <rect x="102" y="72" width="24" height="24" rx="2" />
      </g>
      <rect className="spot-art__seal" x="34" y="38" width="24" height="24" rx="2" fill="var(--art-soft)" stroke="var(--art-brass)" strokeWidth="1.5" />
      <path d="M46 44v12M40 50h12" />
    </>
  ),
  // Recibo gravado; a última linha em latão claro. Sem moeda e sem número.
  noSales: (
    <>
      {rosette(80, 60, 40, 18, 9)}
      <path d="M56 12h48v84l-6-5-6 5-6-5-6 5-6-5-6 5-6-5-6 5z" fill="var(--art-paper)" />
      {waves(62, [22, 27], 6)}
      <path d="M62 40h22M62 49h22M62 58h22M62 67h22" opacity=".35" />
      <path d="M90 40h8M90 49h8M90 58h8M90 67h8" opacity=".35" />
      <rect className="spot-art__seal" x="62" y="75" width="36" height="7" rx="1.5" fill="var(--art-soft)" stroke="var(--art-brass)" strokeWidth="1.5" />
    </>
  ),
  // O documento com o selo de check carimbado, a roseta e três losangos.
  published: (
    <>
      {rosette(80, 58, 50, 22, 12)}
      <rect x="52" y="12" width="56" height="76" rx="2" fill="var(--art-paper)" />
      {waves(60, [22, 27], 7)}
      <rect x="60" y="36" width="24" height="3" fill="currentColor" stroke="none" />
      <path d="M60 47h40M60 55h32M60 63h40" opacity=".35" />
      <g className="spot-art__seal">
        <rect x="90" y="68" width="26" height="26" rx="2" fill="var(--art-brass)" stroke="none" />
        <path d="M96.5 81.5l4.5 4.5 9-9.5" stroke="var(--art-on-brass)" strokeWidth="1.5" />
      </g>
      <g className="spot-art__spark" fill="var(--art-soft)">
        <path d="M130 26l4 4-4 4-4-4z" />
        <path d="M34 78l3.5 3.5-3.5 3.5-3.5-3.5z" />
        <path d="M128 92l3 3-3 3-3-3z" />
      </g>
    </>
  ),
};

/**
 * Check que se desenha ao aparecer (catálogo de movimento, item 5). O mesmo
 * traço do `Check` do lucide; `pathLength=1` deixa o CSS animar o
 * stroke-dashoffset sem medir o caminho. Com "reduzir movimento", ele já
 * nasce inteiro.
 */
export function DrawnCheck({
  size = 15,
  strokeWidth = 2.4,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cn("drawn-check shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" pathLength={1} />
    </svg>
  );
}

/**
 * O selo de marco (barra em 100%): a geometria do VerifiedSeal, em latão com
 * check marinho (6,67:1). Decorativo: o número ao lado já diz "100%".
 */
export function MilestoneSeal({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      data-milestone-seal=""
      className={cn("milestone-seal shrink-0", className)}
    >
      <rect width="16" height="16" rx="4" fill="var(--color-accent,#c99a46)" />
      <path d="M4.2 8.3 6.9 11l4.9-5.6" fill="none" stroke="#091d2f" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export function SpotArt({ scene, tone = "default", className }: SpotArtProps) {
  return (
    <svg
      viewBox="0 0 160 120"
      aria-hidden="true"
      focusable="false"
      data-scene={scene}
      className={cn("spot-art", className)}
      style={tones[tone]}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {scenes[scene]}
    </svg>
  );
}
