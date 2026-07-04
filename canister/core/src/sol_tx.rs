//! Сборка legacy-транзакции Solana БЕЗ solana-sdk (он не собирается в wasm канистры;
//! ручная сборка — стандартный приём канистр Chain Fusion). Формат зафиксирован эталонным
//! тестом против web3.js (`golden_memo_message_matches_web3js`) — как golden-векторы M-1.
//!
//! M0: единственная нужная транзакция — memo от тресхолд-адреса (доказательство контура
//! подписи). M2 добавит `resolve_dispute` эскроу-программы — тот же сборщик, другая инструкция.

/// SPL Memo v2 (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`).
pub const MEMO_PROGRAM_ID: [u8; 32] = [
    5, 74, 83, 90, 153, 41, 33, 6, 77, 36, 232, 113, 96, 218, 56, 124, 124, 53, 181, 221, 188,
    146, 187, 129, 228, 31, 168, 64, 65, 5, 68, 141,
];

/// compact-u16 («shortvec») — переменная длина списков в формате Solana.
fn compact_u16(mut n: u16, out: &mut Vec<u8>) {
    loop {
        let mut byte = (n & 0x7f) as u8;
        n >>= 7;
        if n != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if n == 0 {
            break;
        }
    }
}

/// Legacy-message: один подписант (fee payer = тресхолд-адрес) + одна memo-инструкция.
/// Header [1,0,1]: 1 подпись; fee payer writable; memo-программа readonly-unsigned.
pub fn build_memo_message(signer: &[u8; 32], recent_blockhash: &[u8; 32], memo: &str) -> Vec<u8> {
    let mut m = Vec::with_capacity(128 + memo.len());
    m.extend_from_slice(&[1, 0, 1]); // header
    compact_u16(2, &mut m); // account keys: signer + memo program
    m.extend_from_slice(signer);
    m.extend_from_slice(&MEMO_PROGRAM_ID);
    m.extend_from_slice(recent_blockhash);
    compact_u16(1, &mut m); // instructions
    m.push(1); // program_id_index → memo program
    compact_u16(0, &mut m); // без аккаунтов
    compact_u16(memo.len() as u16, &mut m);
    m.extend_from_slice(memo.as_bytes());
    m
}

/// Готовая транзакция: compact-массив подписей + message. Подпись Ed25519 — ровно 64 байта.
pub fn assemble_tx(signature: &[u8], message: &[u8]) -> Result<Vec<u8>, String> {
    if signature.len() != 64 {
        return Err(format!("подпись {} байт, ожидалось 64", signature.len()));
    }
    let mut tx = Vec::with_capacity(1 + 64 + message.len());
    compact_u16(1, &mut tx);
    tx.extend_from_slice(signature);
    tx.extend_from_slice(message);
    Ok(tx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// Эталон, порождённый web3.js (`Transaction.compileMessage().serialize()`) на тех же
    /// фиксированных входах — сборка обязана совпасть байт-в-байт.
    #[test]
    fn golden_memo_message_matches_web3js() {
        let signer = [9u8; 32];
        let blockhash = [7u8; 32];
        let msg = build_memo_message(&signer, &blockhash, "standing-core M0 threshold test");
        let expected = base64::engine::general_purpose::STANDARD
            .decode(
                "AQABAgkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJBUpTWpkpIQZNJOhxYNo4fHw1td28kruB5B+oQEEFRI0HBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwEBAB9zdGFuZGluZy1jb3JlIE0wIHRocmVzaG9sZCB0ZXN0",
            )
            .unwrap();
        assert_eq!(msg, expected, "сборка message разошлась с web3.js");
    }

    #[test]
    fn compact_u16_encoding() {
        let enc = |n: u16| {
            let mut v = Vec::new();
            compact_u16(n, &mut v);
            v
        };
        assert_eq!(enc(0), vec![0]);
        assert_eq!(enc(1), vec![1]);
        assert_eq!(enc(127), vec![0x7f]);
        assert_eq!(enc(128), vec![0x80, 0x01]);
        assert_eq!(enc(16383), vec![0xff, 0x7f]);
        assert_eq!(enc(16384), vec![0x80, 0x80, 0x01]);
    }

    #[test]
    fn assemble_requires_64_byte_signature() {
        assert!(assemble_tx(&[0u8; 63], &[1, 2, 3]).is_err());
        let tx = assemble_tx(&[0u8; 64], &[1, 2, 3]).unwrap();
        assert_eq!(tx.len(), 1 + 64 + 3);
        assert_eq!(tx[0], 1); // одна подпись
    }
}
