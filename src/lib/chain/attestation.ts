import bs58 from "bs58";
import nacl from "tweetnacl";

/**
 * Аттестация payout-адреса канала (закрывает H1: «payout диктуется сервером»).
 *
 * Владелец канала ОДИН РАЗ подписывает кошельком каноническое сообщение «донаты моему каналу идут на
 * адрес X». С этого момента сервер перестаёт быть источником истины по адресу выплат: клиент донора
 * проверяет подпись ПЕРЕД сборкой транзакции (chain-provider), сервер — при зачёте (ingest). Подмена
 * payout в БД/на сервере без ключа владельца даёт невалидную подпись → донат не собирается и не
 * зачитывается (fail-closed).
 *
 * Остаточное доверие (задокументировано в trust-layers.md): привязка handle → ownerAddress остаётся
 * платформенной. Аттестация гарантирует, что деньги идут туда, куда сказал КЛЮЧ владельца, а не сервер.
 *
 * Изоморфный модуль (bs58 + tweetnacl, без web3.js/node): и браузер (chain-provider, донор), и сервер
 * (mock-provider на createChannel/attestPayout, ingest), и скрипт независимой проверки (verify-export).
 */

/** Каноническое сообщение под подпись. Любое изменение строки ломает существующие подписи — меняй через v. */
export function buildPayoutAttestationMessage(owner: string, payout: string): string {
  return [
    "Standing: подтверждение адреса выплат канала.",
    "",
    "Подписывая, вы заявляете: донаты вашему каналу должны идти на этот адрес.",
    "Это не транзакция: деньги не двигаются и газ не списывается.",
    "",
    `owner: ${owner}`,
    `payout: ${payout}`,
    "v: 1",
  ].join("\n");
}

/** base64 → байты без Buffer-зависимости (браузер); на сервере Buffer быстрее и есть всегда. */
function fromBase64(s: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ed25519-проверка подписи владельца над каноническим сообщением. Любой сбой разбора → false (fail-closed). */
export function verifyPayoutAttestation(
  owner: string,
  payout: string,
  signatureB64: string,
): boolean {
  try {
    const pub = bs58.decode(owner);
    if (pub.length !== 32) return false;
    const sig = fromBase64(signatureB64);
    if (sig.length !== 64) return false;
    const msg = new TextEncoder().encode(buildPayoutAttestationMessage(owner, payout));
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}
