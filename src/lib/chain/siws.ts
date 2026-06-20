/**
 * Sign-In-With-Solana: формат подписываемого сообщения. Общий модуль (без node/web3-зависимостей),
 * чтобы клиент (подпись кошельком) и сервер (проверка) строили БАЙТ-в-БАЙТ одинаковую строку.
 *
 * Замена прежней бутафории: nonce теперь выдаёт сервер (одноразовый, с TTL), а подпись реально
 * проверяется на сервере (см. src/server/auth.ts). Без совпадающего nonce подпись не примут.
 *
 * M1 (аудит): сообщение связано с доменом и временем (domain / issued-at / expires-at, в духе CAIP-122) —
 * подпись для одного приложения/окна не переносится на другое, и пользователь видит, куда он входит.
 */
export const SIWS_STATEMENT =
  "Подписывая это сообщение, вы подтверждаете владение адресом для входа в Standing. " +
  "Это не транзакция: деньги не двигаются и газ не списывается.";

export interface SiwsFields {
  domain: string; // приложение, запросившее вход
  issuedAt: string; // ISO-8601
  expiresAt: string; // ISO-8601 — после этого подпись недействительна
}

/** Каноническое сообщение входа. Любое изменение строки ломает проверку подписи — меняй осознанно. */
export function buildSiwsMessage(address: string, nonce: string, f: SiwsFields): string {
  return [
    `${f.domain} просит вас войти в Standing.`,
    "",
    SIWS_STATEMENT,
    "",
    `address: ${address}`,
    `domain: ${f.domain}`,
    `nonce: ${nonce}`,
    `issued-at: ${f.issuedAt}`,
    `expires-at: ${f.expiresAt}`,
  ].join("\n");
}
