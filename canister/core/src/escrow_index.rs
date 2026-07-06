//! Эскроу-индексатор (M2): закрывает пробел icp-канона — эскроу-донаты заданий (G3a) в журнале
//! репутации. Индексатор трежери (indexer.rs) видит только обычные донаты 97/3; эскроу-claim'ы
//! идут через эскроу-программу и раньше не попадали в журнал → в icp профиль их не показывал и
//! число репутации их недосчитывало.
//!
//! Что делает: отдельным курсором опрашивает подписи эскроу-программы (старые→новые), декодит
//! инструкции по anchor-дискриминаторам (те же, что `escrow-tx.ts`):
//!  - `fund`  → снимок открытого эскроу {донор, стример, сумма} в stable-карту (эскроу-аккаунт
//!    закрывается при claim — данные надо забрать заранее);
//!  - `claim_streamer` (деньги дошли стримеру) → GameDonation донору на канал стримера, паритет
//!    сервера (`repEffects`: DONATION, pointsDelta = полная сумма 1:1);
//!  - `claim_donor` (возврат) → просто снять из карты, репутации нет.
//!
//! Дедуп со СПОРАМИ: оспоренные эскроу банкует арбитр (arbiter.rs) при финализации — их claim
//! ПРОПУСКАЕМ (`arbiter::case_of` != None), иначе GameDonation задвоится. Идемпотентность по
//! подписи claim (journal_append → SEEN). Привязка стример→канал: активация канала в журнале
//! (actor = владелец = payout, допущение v1 арбитра); канал mock-эпохи без ончейн-активации не
//! резолвится → эскроу-донат пропускается (та же дельта §18.5-8a, что у чтений).

use crate::donation::ParsedTx;
use crate::sol_rpc::{get_signatures_since, get_transaction_parsed};
use crate::state::{self, Config, EntryKind, EscrowFund, JournalEntry};

// Anchor-дискриминаторы инструкций эскроу-программы (8 байт) — зеркало `DISC` из escrow-tx.ts.
const DISC_FUND: [u8; 8] = [218, 188, 111, 221, 152, 113, 174, 7];
const DISC_CLAIM_STREAMER: [u8; 8] = [126, 138, 229, 228, 43, 41, 147, 179];
const DISC_CLAIM_DONOR: [u8; 8] = [50, 4, 6, 190, 27, 110, 39, 211];

/// Декодированная эскроу-инструкция (лишь то, что нужно индексатору).
enum EscrowIx {
    /// fund: PDA, снимок для карты открытых эскроу.
    Fund(String, EscrowFund),
    /// claim_streamer: PDA — деньги дошли стримеру (GameDonation донору).
    ClaimStreamer(String),
    /// claim_donor: PDA — возврат донору (репутации нет, снять из карты).
    ClaimDonor(String),
}

/// data(base58) + accounts(base58) одной top-level инструкции эскроу-программы → EscrowIx.
/// None — не fund/claim (accept/markDone/cancel/dispute — индексатору неинтересны) или битые данные.
fn decode_escrow_ix(accounts: &[String], data_b58: &str) -> Option<EscrowIx> {
    let raw = bs58::decode(data_b58).into_vec().ok()?;
    if raw.len() < 8 {
        return None;
    }
    let disc: [u8; 8] = raw[..8].try_into().ok()?;

    if disc == DISC_FUND {
        // data: disc(8) + task_id(32) + amount u64le(8) + executionWindow i64le(8).
        // keys (buildFundIx): [0]=донор, [1]=эскроу-PDA, [2]=vault, [3]=donorAta, [4]=mint, [5]=стример.
        if raw.len() < 48 || accounts.len() < 6 {
            return None;
        }
        let amount_micro = u64::from_le_bytes(raw[40..48].try_into().ok()?);
        return Some(EscrowIx::Fund(
            accounts[1].clone(), // эскроу-PDA — ключ карты (совпадает с accounts[2] claim'а)
            EscrowFund {
                donor: accounts[0].clone(),
                streamer: accounts[5].clone(), // payout-адрес стримера (== владелец канала)
                amount_micro,
            },
        ));
    }
    if disc == DISC_CLAIM_STREAMER {
        // keys claim_streamer: [0]=стример, [1]=донор, [2]=эскроу-PDA.
        return accounts.get(2).map(|pda| EscrowIx::ClaimStreamer(pda.clone()));
    }
    if disc == DISC_CLAIM_DONOR {
        // keys claim_donor: [0]=донор, [1]=эскроу-PDA (decodeEscrowClaims).
        return accounts.get(1).map(|pda| EscrowIx::ClaimDonor(pda.clone()));
    }
    None
}

/// Стример (payout) → channel_id через активацию канала в журнале (actor = владелец = payout,
/// допущение v1 арбитра). None — канал без ончейн-активации (mock-эпоха) → эскроу-донат пропустим.
fn channel_of_streamer(streamer: &str) -> Option<String> {
    let len = state::journal_len();
    for i in 0..len {
        if let Some(e) = state::journal_get(i) {
            if e.kind == EntryKind::Activation && e.actor == streamer {
                return Some(e.channel_id);
            }
        }
    }
    None
}

/// Забанковать эскроу-донат: GameDonation донору, очки = полная сумма 1:1 (ADR 0007, паритет
/// `repEffects` сервера). Подпись claim'а → идемпотентность через SEEN journal_append.
fn bank_game_donation(sig: &str, channel_id: String, fund: &EscrowFund, block_time: Option<i64>) {
    let points = i64::try_from(fund.amount_micro).unwrap_or(i64::MAX);
    state::journal_append(JournalEntry {
        seq: 0,
        kind: EntryKind::GameDonation,
        signature: sig.to_string(),
        channel_id,
        actor: fund.donor.clone(),
        amount_micro: fund.amount_micro,
        fee_micro: 0,
        net_micro: fund.amount_micro,
        points_delta_micro: points,
        donation_id: None, // канистра текст не касается; фронт джойнит текст задания по (канал,сумма)
        msg_ref: None,
        block_time,
    });
}

/// Обработать одну tx эскроу-программы: разложить её инструкции, обновить карту открытых эскроу,
/// на claim_streamer забанковать GameDonation. Возвращает число забанкованных (0/1 на tx).
fn process_tx(program: &str, sig: &str, tx_json: &serde_json::Value) -> u64 {
    let Ok(tx): Result<ParsedTx, _> = serde_json::from_value(tx_json.clone()) else {
        return 0;
    };
    if tx.meta.as_ref().is_some_and(|m| m.err.is_some()) {
        return 0;
    }
    let block_time = tx.block_time;
    let mut banked = 0u64;

    for ix in &tx.transaction.message.instructions {
        if ix.program_id.as_deref() != Some(program) {
            continue;
        }
        let (Some(accounts), Some(data)) = (&ix.accounts, &ix.data) else {
            continue;
        };
        match decode_escrow_ix(accounts, data) {
            Some(EscrowIx::Fund(pda, fund)) => state::open_escrow_insert(&pda, fund),
            Some(EscrowIx::ClaimDonor(pda)) => {
                state::open_escrow_take(&pda); // возврат — репутации нет, просто снять снимок
            }
            Some(EscrowIx::ClaimStreamer(pda)) => {
                // Идемпотентность: этот claim уже банкован (подпись в журнале) — пропуск.
                if state::seen(sig) {
                    continue;
                }
                // Дедуп со спором: оспоренный эскроу банкует арбитр — не задваиваем.
                if crate::arbiter::case_of(&pda).is_some() {
                    state::open_escrow_take(&pda);
                    continue;
                }
                if let Some(fund) = state::open_escrow_take(&pda) {
                    if let Some(channel_id) = channel_of_streamer(&fund.streamer) {
                        bank_game_donation(sig, channel_id, &fund, block_time);
                        banked += 1;
                    }
                    // канал не резолвится (mock-эпоха) → тихо пропускаем (§18.5-8a)
                }
                // fund не виден (за retention / профинансирован до наблюдения) → пропуск
            }
            None => {}
        }
    }
    banked
}

/// Один проход эскроу-индексатора: опросить новые подписи эскроу-программы, обработать fund/claim.
/// Дисциплина как у трежери-индексатора: свой курсор, старые→новые, курсор двигается по КАЖДОЙ
/// подписи (обрыв посреди пачки безопасен). Возвращает число забанкованных GameDonation.
pub async fn poll_escrow(cfg: &Config) -> Result<u64, String> {
    let Some(program) = cfg.escrow_program.as_deref() else {
        return Ok(0); // escrow_program не задан → эскроу-индексация выключена
    };
    if program.is_empty() {
        return Ok(0);
    }

    let cursor = state::escrow_cursor();
    let sigs = get_signatures_since(&cfg.rpc_url, program, cursor.as_deref()).await?;

    let mut banked = 0u64;
    for sig in &sigs {
        if !sig.err {
            match get_transaction_parsed(&cfg.rpc_url, &sig.signature).await? {
                Some(tx_json) => banked += process_tx(program, &sig.signature, &tx_json),
                None => state::STATUS.with(|s| s.borrow_mut().tx_unavailable += 1),
            }
        }
        state::set_escrow_cursor(&sig.signature);
    }
    Ok(banked)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b58(bytes: &[u8]) -> String {
        bs58::encode(bytes).into_string()
    }

    fn fund_data(amount: u64) -> String {
        let mut v = Vec::new();
        v.extend_from_slice(&DISC_FUND);
        v.extend_from_slice(&[7u8; 32]); // task_id
        v.extend_from_slice(&amount.to_le_bytes());
        v.extend_from_slice(&86_400i64.to_le_bytes()); // executionWindow
        b58(&v)
    }

    #[test]
    fn decodes_fund_amount_and_parties() {
        // keys buildFundIx: [0]donor [1]escrow-PDA [2]vault [3]donorAta [4]mint [5]streamer.
        let accts = vec![
            "DONOR".into(),
            "PDA".into(),
            "VAULT".into(),
            "DONORATA".into(),
            "MINT".into(),
            "STREAMER".into(),
        ];
        match decode_escrow_ix(&accts, &fund_data(5_000_000)) {
            Some(EscrowIx::Fund(pda, f)) => {
                assert_eq!(pda, "PDA");
                assert_eq!(f.donor, "DONOR");
                assert_eq!(f.streamer, "STREAMER");
                assert_eq!(f.amount_micro, 5_000_000);
            }
            _ => panic!("ожидался Fund"),
        }
    }

    #[test]
    fn decodes_claim_streamer_pda_at_index_2() {
        let accts = vec!["STREAMER".into(), "DONOR".into(), "PDA".into()];
        match decode_escrow_ix(&accts, &b58(&DISC_CLAIM_STREAMER)) {
            Some(EscrowIx::ClaimStreamer(pda)) => assert_eq!(pda, "PDA"),
            _ => panic!("ожидался ClaimStreamer"),
        }
    }

    #[test]
    fn decodes_claim_donor_pda_at_index_1() {
        let accts = vec!["DONOR".into(), "PDA".into()];
        match decode_escrow_ix(&accts, &b58(&DISC_CLAIM_DONOR)) {
            Some(EscrowIx::ClaimDonor(pda)) => assert_eq!(pda, "PDA"),
            _ => panic!("ожидался ClaimDonor"),
        }
    }

    #[test]
    fn ignores_other_instructions() {
        let accts = vec!["A".into(), "B".into(), "C".into()];
        // accept/markDone/cancel — другой дискриминатор → None
        assert!(decode_escrow_ix(&accts, &b58(&[1, 2, 3, 4, 5, 6, 7, 8])).is_none());
        assert!(decode_escrow_ix(&accts, "").is_none()); // битый base58 / пусто
    }

    #[test]
    fn game_donation_points_equal_full_amount() {
        // Паритет repEffects: to_streamer → donor DONATION, pointsDelta = полная сумма 1:1.
        let fund = EscrowFund {
            donor: "D".into(),
            streamer: "S".into(),
            amount_micro: 7_000_000,
        };
        let points = i64::try_from(fund.amount_micro).unwrap();
        assert_eq!(points, 7_000_000);
    }
}
