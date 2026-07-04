//! Тресхолд-Ed25519-подписант (M0): канистра владеет Solana-адресом, ключ которого НЕ существует
//! целиком нигде — подпись рождается консенсусом узлов подсети (локально — тестовый ключ реплики
//! `dfx_test_key`). Это контур, который на M2 станет резолвером эскроу (`RESOLVER` = этот адрес);
//! M0 доказывает его тестовой memo-транзакцией в devnet ДО того, как он коснётся денег.

use crate::sol_rpc;
use crate::sol_tx;
use crate::state;
use base64::Engine;
use candid::Principal;
use ic_cdk::call::Call;
use ic_management_canister_types::{
    SchnorrAlgorithm, SchnorrKeyId, SchnorrPublicKeyArgs, SchnorrPublicKeyResult,
    SignWithSchnorrArgs, SignWithSchnorrResult,
};
use std::cell::RefCell;

/// Домен вывода ключа: один канистра-ключ → разные адреса под разные роли; наш — резолвер Solana.
const DERIVATION_PATH: &[&[u8]] = &[b"solana-resolver"];

/// Запас циклов на подпись, если системный прайсер недоступен (mainnet ~26B; локально бесплатно).
const SIGN_CYCLES_FALLBACK: u128 = 30_000_000_000;

thread_local! {
    /// Кэш пабкея (management-вызов дорогой/медленный; ключ канистры неизменен).
    static PUBKEY: RefCell<Option<[u8; 32]>> = const { RefCell::new(None) };
}

fn key_id() -> SchnorrKeyId {
    SchnorrKeyId {
        algorithm: SchnorrAlgorithm::Ed25519,
        name: state::config().schnorr_key_name.unwrap_or_else(|| "dfx_test_key".into()),
    }
}

fn derivation_path() -> Vec<Vec<u8>> {
    DERIVATION_PATH.iter().map(|p| p.to_vec()).collect()
}

/// Тресхолд-пабкей канистры (32 байта Ed25519) — он же Solana-адрес.
pub async fn threshold_pubkey() -> Result<[u8; 32], String> {
    if let Some(pk) = PUBKEY.with(|c| *c.borrow()) {
        return Ok(pk);
    }
    let args = SchnorrPublicKeyArgs {
        canister_id: None, // = сама канистра
        derivation_path: derivation_path(),
        key_id: key_id(),
    };
    let resp = Call::unbounded_wait(Principal::management_canister(), "schnorr_public_key")
        .with_arg(&args)
        .await
        .map_err(|e| format!("schnorr_public_key: {e:?}"))?;
    let out: SchnorrPublicKeyResult = resp
        .candid()
        .map_err(|e| format!("schnorr_public_key decode: {e:?}"))?;
    let pk: [u8; 32] = out
        .public_key
        .as_slice()
        .try_into()
        .map_err(|_| format!("ed25519 pubkey {} байт, ожидалось 32", out.public_key.len()))?;
    PUBKEY.with(|c| *c.borrow_mut() = Some(pk));
    Ok(pk)
}

/// Solana-адрес резолвера (base58 от тресхолд-пабкея).
pub async fn solana_address() -> Result<String, String> {
    Ok(bs58::encode(threshold_pubkey().await?).into_string())
}

/// Тресхолд-подпись произвольного сообщения (для Solana — сериализованного message).
pub async fn sign(message: Vec<u8>) -> Result<Vec<u8>, String> {
    let kid = key_id();
    let cycles = ic_cdk::api::cost_sign_with_schnorr(&kid.name, kid.algorithm.into())
        .unwrap_or(SIGN_CYCLES_FALLBACK);
    let args = SignWithSchnorrArgs {
        message,
        derivation_path: derivation_path(),
        key_id: kid,
        aux: None,
    };
    let resp = Call::unbounded_wait(Principal::management_canister(), "sign_with_schnorr")
        .with_arg(&args)
        .with_cycles(cycles)
        .await
        .map_err(|e| format!("sign_with_schnorr: {e:?}"))?;
    let out: SignWithSchnorrResult = resp
        .candid()
        .map_err(|e| format!("sign_with_schnorr decode: {e:?}"))?;
    Ok(out.signature)
}

/// M0-светофор: подписать и отправить в devnet ЖИВУЮ memo-транзакцию от тресхолд-адреса.
/// Полный контур будущего резолвера: blockhash из цепи → сборка → тресхолд-подпись → send.
pub async fn test_sign_and_send(memo: String) -> Result<String, String> {
    if memo.is_empty() || memo.len() > 256 {
        return Err("memo: 1..256 байт".into());
    }
    let cfg = state::config();
    let pubkey = threshold_pubkey().await?;

    // Свежий blockhash честно приходит из цепи outcall'ом. (Durable nonce — обход для
    // КОНСЕНСУСА подсети mainnet; на локальной одиночной реплике не нужен — гейт M5.)
    let blockhash_b58 = sol_rpc::get_latest_blockhash(&cfg.rpc_url).await?;
    let mut blockhash = [0u8; 32];
    let n = bs58::decode(&blockhash_b58)
        .onto(&mut blockhash)
        .map_err(|e| format!("blockhash decode: {e}"))?;
    if n != 32 {
        return Err(format!("blockhash {n} байт, ожидалось 32"));
    }

    let message = sol_tx::build_memo_message(&pubkey, &blockhash, &memo);
    let signature = sign(message.clone()).await?;
    let tx = sol_tx::assemble_tx(&signature, &message)?;
    let tx_b64 = base64::engine::general_purpose::STANDARD.encode(tx);

    let sig = sol_rpc::send_transaction(&cfg.rpc_url, &tx_b64).await?;
    state::STATUS.with(|s| s.borrow_mut().last_test_tx = Some(sig.clone()));
    Ok(sig)
}
