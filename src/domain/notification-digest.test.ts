import { describe, expect, it } from "vitest";

import { digestTurnedOff, selectDigests, type DigestRow } from "@/domain/notification-digest";

// Quem recebe o "voce tem N notificacoes novas" de hora em hora, e de quais
// avisos. A rota so busca as linhas; a regra inteira mora aqui.

const NOW = Date.parse("2026-10-06T12:07:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

let seq = 0;
function row(userId: string, ageMinutes: number, extra: Partial<DigestRow> = {}): DigestRow {
  seq += 1;
  return {
    notification_id: `n-${seq}`,
    user_id: userId,
    created_at: minutesAgo(ageMinutes),
    read: false,
    emailed_at: null,
    ...extra,
  };
}
const none = new Set<string>();

describe("selectDigests", () => {
  it("junta os avisos nao lidos e nunca enviados de cada pessoa num e-mail so", () => {
    const a1 = row("ana", 30);
    const a2 = row("ana", 15);
    const b1 = row("bia", 45);

    expect(selectDigests([a1, a2, b1], none, NOW)).toEqual([
      { userId: "bia", notificationIds: [b1.notification_id] },
      { userId: "ana", notificationIds: [a1.notification_id, a2.notification_id] },
    ]);
  });

  it("espera 10 minutos: a pessoa ainda pode estar no site e ver no sino", () => {
    expect(selectDigests([row("ana", 9)], none, NOW)).toEqual([]);
    expect(selectDigests([row("ana", 10)], none, NOW)).toHaveLength(1);
  });

  it("deixa de fora o que ja foi lido ou ja saiu por e-mail", () => {
    const fresh = row("ana", 20);
    const rows = [
      row("ana", 20, { read: true }),
      row("ana", 200, { emailed_at: minutesAgo(120) }),
      fresh,
    ];

    expect(selectDigests(rows, none, NOW)).toEqual([
      { userId: "ana", notificationIds: [fresh.notification_id] },
    ]);
  });

  it("no maximo um e-mail por hora: quem recebeu ha menos de 60 minutos espera", () => {
    const sentRecently = row("ana", 90, { emailed_at: minutesAgo(59) });
    const sentLongAgo = row("bia", 200, { emailed_at: minutesAgo(61) });

    expect(selectDigests([sentRecently, row("ana", 20)], none, NOW)).toEqual([]);
    expect(selectDigests([sentLongAgo, row("bia", 20)], none, NOW)).toHaveLength(1);
  });

  it("aviso velho (mais de 3 dias) nunca vira e-mail", () => {
    expect(selectDigests([row("ana", 3 * 24 * 60 + 1)], none, NOW)).toEqual([]);
    expect(selectDigests([row("ana", 3 * 24 * 60)], none, NOW)).toHaveLength(1);
  });

  it("quem desligou o resumo nao recebe", () => {
    expect(selectDigests([row("ana", 20), row("bia", 20)], new Set(["ana"]), NOW).map((d) => d.userId)).toEqual([
      "bia",
    ]);
  });

  it("a mesma linha vinda duas vezes conta uma vez so", () => {
    const once = row("ana", 20);
    expect(selectDigests([once, { ...once }], none, NOW)).toEqual([
      { userId: "ana", notificationIds: [once.notification_id] },
    ]);
  });

  it("data ausente ou invalida nao entra", () => {
    expect(selectDigests([row("ana", 20, { created_at: null }), row("bia", 20, { created_at: "x" })], none, NOW)).toEqual(
      [],
    );
  });
});

describe("digestTurnedOff", () => {
  it("so desliga com false explicito; sem preferencia gravada o resumo vale", () => {
    expect(digestTurnedOff({ notifications: { emailDigest: false } })).toBe(true);
    expect(digestTurnedOff({ notifications: { emailDigest: true } })).toBe(false);
    expect(digestTurnedOff({ notifications: { marketingEmails: false } })).toBe(false);
    expect(digestTurnedOff({})).toBe(false);
    expect(digestTurnedOff(null)).toBe(false);
  });
});
