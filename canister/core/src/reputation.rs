//! Порт `src/lib/reputation.ts` (golden-паритет: testdata/golden/reputation.json).
//!
//! КАНОН — целые micro-очки (1 очко = 1_000_000 micro), как и сказано в testdata/golden/README.md:
//! TS суммирует в целых micro и делит на 1e6 только на границе UI; здесь float не появляется вовсе.
//! Курс фиксирован: 1 USDC = 1 очко → micro-очки == micro-USDC 1:1 (POINTS_PER_USDC = 1, ADR 0007).

/// micro-очков в одном очке (= точность денег, 6 знаков).
pub const MICRO_PER_POINT: i128 = 1_000_000;

/// Запись журнала в канистре: только то, что нужно свёртке. Времена — epoch мс (без ISO-парсера).
#[derive(Debug, Clone, Copy)]
pub struct LedgerEntry {
    pub points_delta_micro: i128,
    pub ts_ms: i64,
}

/// Порт `pointsForAmount`: очки за донат в micro. 1:1 к micro-USDC; не-положительное → 0.
pub fn points_for_amount_micro(amount_micro: i128) -> i128 {
    if amount_micro <= 0 {
        0
    } else {
        amount_micro
    }
}

/// Порт `computePoints`: свёртка дельт с клампом к ≥0 ОДИН раз в конце (не по шагам) —
/// порядок событий не влияет на итог (§4.4 детерминизм).
pub fn compute_points_micro(deltas: impl IntoIterator<Item = i128>) -> i128 {
    let sum: i128 = deltas.into_iter().sum();
    sum.max(0)
}

/// Порт `computePointsAsOf`: та же свёртка по срезу `ts_ms <= as_of_ms` (граница ВКЛЮЧИТЕЛЬНА —
/// пин golden-вектора `asof-first-exact`). Нужна спорам: вес голоса = снэпшот на момент открытия.
pub fn compute_points_micro_as_of(entries: &[LedgerEntry], as_of_ms: i64) -> i128 {
    compute_points_micro(
        entries
            .iter()
            .filter(|e| e.ts_ms <= as_of_ms)
            .map(|e| e.points_delta_micro),
    )
}
