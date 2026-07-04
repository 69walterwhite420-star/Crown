//! Golden-паритет TS ↔ Rust (docs/migration-plan.md §0.1): эти тесты читают ТЕ ЖЕ векторы,
//! что породил `npm run golden` из живой TS-логики, и требуют совпадения байт-в-байт.
//! Расхождение хоть в одном векторе = стоп миграции.
//!
//! Светофор: `npm run golden && (cd canister && cargo test)`.

use serde_json::Value;
use standing_core::disputes::{tally, Vote, VoteChoice};
use standing_core::donation::{extract_activation, extract_donation, ParsedTx};
use standing_core::reputation::{
    compute_points_micro, compute_points_micro_as_of, points_for_amount_micro, LedgerEntry,
};
use std::path::PathBuf;

fn golden(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/golden")
        .join(name);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "не найден {} ({e}) — сначала выгрузи эталон: `npm run golden`",
            path.display()
        )
    });
    serde_json::from_str(&raw).expect("golden-файл не парсится")
}

fn as_vec<'a>(v: &'a Value, key: &str) -> &'a Vec<Value> {
    v.get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("в golden нет массива `{key}`"))
}

fn parse_tx(v: &Value) -> Option<ParsedTx> {
    if v.is_null() {
        None
    } else {
        Some(serde_json::from_value(v.clone()).expect("tx-срез не парсится в ParsedTx"))
    }
}

// ─────────────── donations.json ───────────────

#[test]
fn golden_donations() {
    let g = golden("donations.json");
    let mint = g["addresses"]["MINT"].as_str().unwrap();
    let treasury = g["addresses"]["TREASURY_ATA"].as_str().unwrap();

    for vector in as_vec(&g, "donations") {
        let name = vector["name"].as_str().unwrap();
        let tx = parse_tx(&vector["tx"]);
        let signature = vector["signature"].as_str().unwrap();
        let got = extract_donation(tx.as_ref(), signature, mint, treasury)
            .map(|d| d.to_json())
            .unwrap_or(Value::Null);
        assert_eq!(got, vector["expected"], "donation vector `{name}` разошёлся");
    }
}

#[test]
fn golden_activations() {
    let g = golden("donations.json");
    let mint = g["addresses"]["MINT"].as_str().unwrap();
    let treasury = g["addresses"]["TREASURY_ATA"].as_str().unwrap();

    for vector in as_vec(&g, "activations") {
        let name = vector["name"].as_str().unwrap();
        let tx = parse_tx(&vector["tx"]);
        let signature = vector["signature"].as_str().unwrap();
        let got = extract_activation(tx.as_ref(), signature, mint, treasury)
            .map(|a| a.to_json())
            .unwrap_or(Value::Null);
        assert_eq!(got, vector["expected"], "activation vector `{name}` разошёлся");
    }
}

// ─────────────── reputation.json ───────────────

fn entries(v: &Value) -> Vec<LedgerEntry> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|e| LedgerEntry {
            points_delta_micro: e["pointsDeltaMicro"].as_i64().unwrap() as i128,
            ts_ms: e["tsMs"].as_i64().unwrap(),
        })
        .collect()
}

#[test]
fn golden_points_for_amount() {
    let g = golden("reputation.json");
    for vector in as_vec(&g, "pointsForAmount") {
        let amount: i128 = vector["amountMicro"].as_str().unwrap().parse().unwrap();
        let expected = vector["expectedMicroPoints"].as_i64().unwrap() as i128;
        assert_eq!(points_for_amount_micro(amount), expected, "pointsForAmount({amount})");
    }
}

#[test]
fn golden_compute_points() {
    let g = golden("reputation.json");
    for vector in as_vec(&g, "computePoints") {
        let name = vector["name"].as_str().unwrap();
        let got = compute_points_micro(entries(&vector["events"]).iter().map(|e| e.points_delta_micro));
        let expected = vector["expectedMicroPoints"].as_i64().unwrap() as i128;
        assert_eq!(got, expected, "computePoints `{name}`");
    }
}

#[test]
fn golden_compute_points_as_of() {
    let g = golden("reputation.json");
    for vector in as_vec(&g, "computePointsAsOf") {
        let name = vector["name"].as_str().unwrap();
        let got = compute_points_micro_as_of(&entries(&vector["events"]), vector["asOfMs"].as_i64().unwrap());
        let expected = vector["expectedMicroPoints"].as_i64().unwrap() as i128;
        assert_eq!(got, expected, "computePointsAsOf `{name}`");
    }
}

// ─────────────── disputes.json ───────────────

fn parse_votes(v: &Value) -> Vec<Vote> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|vote| Vote {
            voter: vote["voter"].as_str().unwrap().to_string(),
            choice: match vote["choice"].as_str().unwrap() {
                "completed" => VoteChoice::Completed,
                "not_completed" => VoteChoice::NotCompleted,
                other => panic!("неизвестный choice `{other}`"),
            },
            weight_micro: vote["weightMicro"].as_i64().unwrap() as i128,
        })
        .collect()
}

#[test]
fn golden_tally() {
    let g = golden("disputes.json");
    for vector in as_vec(&g, "tally") {
        let name = vector["name"].as_str().unwrap();
        let votes = parse_votes(&vector["dispute"]["votes"]);
        let quorum = vector["dispute"]["quorumMicro"].as_i64().unwrap() as i128;
        let (outcome, reason) = tally(&votes, quorum);
        assert_eq!(outcome.as_str(), vector["expected"]["outcome"].as_str().unwrap(), "tally `{name}` outcome");
        assert_eq!(reason.as_str(), vector["expected"]["reason"].as_str().unwrap(), "tally `{name}` reason");
    }
}

/// TODO(M2): полный порт машины (переходы/окна/эффекты) — сценарии уже выгружены; пока
/// пиним только структуру векторов, чтобы регенерация эталона не сломала будущий порт молча.
#[test]
fn golden_scenarios_structure() {
    let g = golden("disputes.json");
    let scenarios = as_vec(&g, "scenarios");
    assert!(!scenarios.is_empty(), "сценарии машины споров пусты");
    for s in scenarios {
        let name = s["name"].as_str().expect("у сценария нет name");
        assert!(s["create"]["expected"].is_object(), "`{name}`: нет create.expected");
        assert!(s["final"]["task"].is_object(), "`{name}`: нет final.task");
        for step in s["steps"].as_array().unwrap() {
            let expected = step["expected"].as_object().unwrap_or_else(|| panic!("`{name}`: шаг без expected"));
            assert!(
                expected.contains_key("error") || expected.contains_key("task") || expected.contains_key("due"),
                "`{name}`: expected без error/task/due"
            );
        }
    }
    // Константы окон присутствуют — M2-порт обязан читать их отсюда, не хардкодить.
    for key in ["grace", "executionDefault", "executionMin", "executionMax", "disputeWindow", "voting"] {
        assert!(g["constants"]["WINDOWS"][key].is_number(), "нет WINDOWS.{key}");
    }
}
