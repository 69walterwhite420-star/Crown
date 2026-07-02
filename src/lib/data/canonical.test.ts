import { describe, expect, it } from "vitest";
import { sha256Hex, stableStringify } from "./canonical";

describe("stableStringify (детерминизм дайджестов якоря)", () => {
  it("не зависит от порядка ключей (in-memory vs восстановленный из БД)", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("bigint сериализуется стабильно (деньги в micro-USDC)", () => {
    expect(stableStringify({ amount: 5_000_000n })).toBe('{"amount":"__bigint:5000000"}');
  });

  it("отсутствующее поле и поле undefined дают один дайджест", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it("массивы сохраняют порядок (журнал — append-only, порядок значим)", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe("sha256Hex", () => {
  it("известный вектор SHA-256, БЕЗ нормализации регистра (base58-адреса регистрозависимы)", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("ABC")).not.toBe(await sha256Hex("abc"));
  });
});
