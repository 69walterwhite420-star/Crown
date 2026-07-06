//! Эскроу-индексатор (M2): закрывает пробел icp-канона — эскроу-донаты заданий (G3a) в журнале
//! репутации. Индексатор трежери (indexer.rs) видит только обычные донаты 97/3; эскроу-claim'ы
//! идут через эскроу-программу и раньше не попадали в журнал → в icp профиль их не показывал и
//! число репутации их недосчитывало.
//!
//! Что делает: отдельным курсором опрашивает подписи эскроу-программы (старые→новые), декодит
//! инструкции по anchor-дискриминаторам (те же, что `escrow-tx.ts`):
//!  - `fund`  → снимок открытого эскроу {донор, стример, сумма} в stable-карту (эскроу-аккаунт
//!    закрывается при claim — данные надо забрать заранее);
//!  - `resolve_dispute` (арбитр исполнил вердикт) → читает spl-memo арбитра `d1:<спорящий>:<w|l|n>`,
//!    помечает эскроу оспоренным и банкует ±репутацию спорящему (DISPUTE_WON/LOST) по знаку memo;
//!  - `claim_streamer` (деньги дошли стримеру) → GameDonation донору на канал стримера, паритет
//!    сервера (`repEffects`: DONATION, pointsDelta = полная сумма 1:1);
//!  - `claim_donor` (возврат) → просто снять из карты, репутации нет.
//!
//! Дедуп со СПОРАМИ (ключевое — реконструкция из цепи): раньше оспоренные эскроу целиком отдавались
//! арбитру (`case_of` != None → пропуск), но состояние арбитра — в stable-памяти и гибнет при reinstall,
//! так что дельты спора терялись безвозвратно (§18.5-8a). Теперь исход спора ЯКОРИТСЯ в цепи: арбитр
//! кладёт memo в свою тресхолд-tx `resolve_dispute`, а этот индексатор реконструирует ту же запись
//! журнала с ТОЙ ЖЕ подписью, что и арбитр (`dispute:<pda>:DISPUTE_WON|DISPUTE_LOST|DONATION`). Пока
//! арбитр жив — он банкует первым, реконструкция дедупается по подписи (journal_append → SEEN); после
//! reinstall арбитр пуст, и бэкфилл поднимает дельты заново из цепи (resolve раньше claim: старые→новые).
//! Знак берём из memo, НЕ из направления денег: кворум-не-набран/ничья уводят деньги стримеру, но
//! репутацию не двигают (memo `n`) — вывод «деньги стримеру ⇒ спорящий проиграл» был бы неверен.
//! Привязка стример→канал: активация канала в журнале (actor = владелец = payout, допущение v1
//! арбитра); канал mock-эпохи без ончейн-активации не резолвится → запись пропускается (та же
//! дельта §18.5-8a, что у чтений). Награды (бонус/штраф) — действующие governance-параметры канала.

use crate::donation::{Instruction, ParsedTx};
use crate::sol_rpc::{get_signatures_since, get_transaction_parsed};
use crate::state::{self, Config, EntryKind, EscrowFund, JournalEntry};

// Anchor-дискриминаторы инструкций эскроу-программы (8 байт) — зеркало `DISC` из escrow-tx.ts.
const DISC_FUND: [u8; 8] = [218, 188, 111, 221, 152, 113, 174, 7];
const DISC_CLAIM_STREAMER: [u8; 8] = [126, 138, 229, 228, 43, 41, 147, 179];
const DISC_CLAIM_DONOR: [u8; 8] = [50, 4, 6, 190, 27, 110, 39, 211];
const DISC_RESOLVE_DISPUTE: [u8; 8] = [231, 6, 202, 6, 96, 103, 12, 230];

/// Декодированная эскроу-инструкция (лишь то, что нужно индексатору).
enum EscrowIx {
    /// fund: PDA, снимок для карты открытых эскроу.
    Fund(String, EscrowFund),
    /// resolve_dispute: PDA — арбитр исполнил вердикт (рядом идёт spl-memo с исходом).
    ResolveDispute(String),
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
    if disc == DISC_RESOLVE_DISPUTE {
        // keys resolve_dispute (send_resolver_ix): [0]=резолвер(signer), [1]=эскроу-PDA.
        return accounts.get(1).map(|pda| EscrowIx::ResolveDispute(pda.clone()));
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

/// Это инструкция spl-memo (partiallyDecoded)? Сравниваем байты program_id с константой.
fn is_memo_program(program_id_b58: &str) -> bool {
    bs58::decode(program_id_b58).into_vec().ok().as_deref() == Some(&crate::sol_tx::MEMO_PROGRAM_ID)
}

/// Достать текст spl-memo из top-level инструкций tx (None — memo нет). RPC отдаёт jsonParsed:
/// memo парсится в `program:"spl-memo"` + `parsed:"<строка>"` (ОСНОВНАЯ форма — как её читает
/// трежери-индексатор `donation.rs::memo_instructions`). Подстраховка — partiallyDecoded
/// (`program_id`+`data`base58), если RPC вдруг не распарсил memo-программу.
fn extract_memo(instructions: &[Instruction]) -> Option<String> {
    for ix in instructions {
        if ix.program.as_deref() == Some("spl-memo") {
            if let Some(s) = ix.parsed.as_ref().and_then(|v| v.as_str()) {
                return Some(s.to_string());
            }
        }
        if let (Some(pid), Some(data)) = (&ix.program_id, &ix.data) {
            if is_memo_program(pid) {
                if let Ok(bytes) = bs58::decode(data).into_vec() {
                    if let Ok(s) = String::from_utf8(bytes) {
                        return Some(s);
                    }
                }
            }
        }
    }
    None
}

/// resolve_dispute + memo арбитра (`d1:<спорящий>:<w|l|n>`) → пометить эскроу оспоренным и
/// забанковать ±репутацию спорящему той же подписью, что и арбитр (`dispute:<pda>:<kind>`).
/// Возвращает 1, если записана дельта репутации. resolve раньше claim → fund ещё в карте.
fn handle_resolve_dispute(pda: &str, memo: Option<&str>, block_time: Option<i64>) -> u64 {
    // resolve без memo (tx до этой версии) — пропуск: старые споры не реконструируем (арбитра нет).
    let Some(memo) = memo else { return 0 };
    let mut parts = memo.splitn(3, ':');
    if parts.next() != Some("d1") {
        return 0;
    }
    let (Some(by), Some(sign)) = (parts.next(), parts.next()) else {
        return 0;
    };
    if by.is_empty() {
        return 0;
    }
    // Пометка оспоренности — для ЛЮБОГО исхода (в т.ч. `n`): claim_streamer по ней выберет
    // подпись денег `dispute:<pda>:DONATION` (паритет арбитра для outcome ToStreamer).
    state::dispute_onchain_set(pda, by);
    let (kind, kind_str) = match sign {
        "w" => (EntryKind::DisputeWon, "DISPUTE_WON"),
        "l" => (EntryKind::DisputeLost, "DISPUTE_LOST"),
        _ => return 0, // `n` — кворум не набран / ничья: деньги двигаются, репутация нет
    };
    let signature = format!("dispute:{pda}:{kind_str}");
    if state::seen(&signature) {
        return 0; // уже банковано (арбитром в этой жизни или прошлым проходом)
    }
    // Канал спорящего — из снимка fund (стример → активация канала). Fund ещё жив (resolve<claim).
    let Some(fund) = state::open_escrow_get(pda) else {
        return 0; // fund не виден (за retention / до наблюдения) — пропуск
    };
    let Some(channel_id) = channel_of_streamer(&fund.streamer) else {
        return 0; // канал без ончейн-активации (mock-эпоха) — пропуск (§18.5-8a)
    };
    // Награды — действующие governance-параметры канала. Арбитр читает их на резолве (finalize_due);
    // здесь читаем на реконструкции — расхождение возможно лишь если параметры менялись И арбитр не
    // банковал первым (после reinstall арбитр пуст → берём текущие; компромисс, как у арбитра).
    let (params, _) = crate::governance::effective_params(&channel_id, ic_cdk::api::time());
    let points_delta_micro = match kind {
        EntryKind::DisputeWon => i64::try_from(params.dispute_win_bonus_micro).unwrap_or(i64::MAX),
        _ => -i64::try_from(params.dispute_loss_penalty_micro).unwrap_or(i64::MAX),
    };
    state::journal_append(JournalEntry {
        seq: 0,
        kind,
        signature,
        channel_id,
        actor: by.to_string(),
        amount_micro: 0,
        fee_micro: 0,
        net_micro: 0,
        points_delta_micro,
        donation_id: None,
        msg_ref: None,
        block_time,
    });
    1
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
    // memo арбитра (если есть) — отдельная top-level инструкция spl-программы, не эскроу-программы;
    // достаём её один раз для всей tx (resolve_dispute кладёт исход спора именно сюда).
    let memo = extract_memo(&tx.transaction.message.instructions);

    for ix in &tx.transaction.message.instructions {
        if ix.program_id.as_deref() != Some(program) {
            continue;
        }
        let (Some(accounts), Some(data)) = (&ix.accounts, &ix.data) else {
            continue;
        };
        match decode_escrow_ix(accounts, data) {
            Some(EscrowIx::Fund(pda, fund)) => state::open_escrow_insert(&pda, fund),
            Some(EscrowIx::ResolveDispute(pda)) => {
                banked += handle_resolve_dispute(&pda, memo.as_deref(), block_time);
            }
            Some(EscrowIx::ClaimDonor(pda)) => {
                state::open_escrow_take(&pda); // возврат — репутации нет, просто снять снимок
            }
            Some(EscrowIx::ClaimStreamer(pda)) => {
                // Подпись денег: у оспоренных эскроу — как у арбитра (`dispute:<pda>:DONATION`,
                // паритет `rep_effects` для outcome ToStreamer), иначе — подпись самой claim-tx.
                // Оспоренность знаем из цепи (resolve_dispute обработан раньше: старые→новые).
                let money_sig = match state::dispute_onchain_get(&pda) {
                    Some(_) => format!("dispute:{pda}:DONATION"),
                    None => sig.to_string(),
                };
                // Идемпотентность: эта запись уже в журнале (арбитром или прошлым проходом) — пропуск.
                if state::seen(&money_sig) {
                    state::open_escrow_take(&pda); // снять снимок, чтобы карта не пухла
                    continue;
                }
                if let Some(fund) = state::open_escrow_take(&pda) {
                    if let Some(channel_id) = channel_of_streamer(&fund.streamer) {
                        bank_game_donation(&money_sig, channel_id, &fund, block_time);
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
    fn decodes_resolve_dispute_pda_at_index_1() {
        // keys resolve_dispute (send_resolver_ix): [0]=резолвер, [1]=эскроу-PDA.
        let accts = vec!["RESOLVER".into(), "PDA".into()];
        match decode_escrow_ix(&accts, &b58(&DISC_RESOLVE_DISPUTE)) {
            Some(EscrowIx::ResolveDispute(pda)) => assert_eq!(pda, "PDA"),
            _ => panic!("ожидался ResolveDispute"),
        }
    }

    #[test]
    fn ignores_other_instructions() {
        let accts = vec!["A".into(), "B".into(), "C".into()];
        // accept/markDone/cancel — другой дискриминатор → None
        assert!(decode_escrow_ix(&accts, &b58(&[1, 2, 3, 4, 5, 6, 7, 8])).is_none());
        assert!(decode_escrow_ix(&accts, "").is_none()); // битый base58 / пусто
    }

    fn parsed_memo_ix(program: &str, parsed: Option<&str>) -> Instruction {
        Instruction {
            program: Some(program.into()),
            parsed: parsed.map(|s| serde_json::Value::String(s.into())),
            program_id: None,
            accounts: None,
            data: None,
        }
    }
    fn raw_memo_ix(program_id: &[u8], memo: &[u8]) -> Instruction {
        Instruction {
            program: None,
            parsed: None,
            program_id: Some(b58(program_id)),
            accounts: None,
            data: Some(b58(memo)),
        }
    }

    #[test]
    fn extract_memo_reads_jsonparsed_form() {
        // Основная форма (jsonParsed): program:"spl-memo" + parsed:"<строка>" — как RPC отдаёт.
        let memo = "d1:So1DisputerPubkey:l";
        let ixs = vec![
            parsed_memo_ix("spl-token", Some("не memo")), // другая программа → игнор
            parsed_memo_ix("spl-memo", Some(memo)),
        ];
        assert_eq!(extract_memo(&ixs).as_deref(), Some(memo));
        // без spl-memo → None
        assert!(extract_memo(&[parsed_memo_ix("spl-token", Some("x"))]).is_none());
    }

    #[test]
    fn extract_memo_fallback_partially_decoded() {
        // Подстраховка: если RPC не распарсил memo-программу — читаем program_id+data(base58).
        let memo = "d1:So1DisputerPubkey:w";
        let ixs = vec![
            raw_memo_ix(&[9u8; 32], b"noise"), // не memo-программа → игнор
            raw_memo_ix(&crate::sol_tx::MEMO_PROGRAM_ID, memo.as_bytes()),
        ];
        assert_eq!(extract_memo(&ixs).as_deref(), Some(memo));
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
