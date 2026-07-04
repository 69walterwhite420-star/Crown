//! Споры и голосование — порт `src/games/escrow-task/machine.ts`.
//!
//! M-1: портирован только `tally` (подсчёт голосов) — он проверяется golden-векторами уже сейчас.
//! Остальная машина (переходы задания, окна, депозит, ed25519-приём голосов) — фаза M2
//! (docs/migration-plan.md §4); её сценарные golden-векторы уже выгружены и ждут порт.
//!
//! ВАЖНО (решение M2, зафиксировано в golden/README.md п.6): веса считаем в ЦЕЛЫХ micro-очках,
//! не в f64 — TS-float на адверсариальных дробях может дать иной исход у границы «ничья»;
//! канон канистры — целочисленная арифметика.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoteChoice {
    Completed,
    NotCompleted,
}

#[derive(Debug, Clone)]
pub struct Vote {
    pub voter: String,
    pub choice: VoteChoice,
    pub weight_micro: i128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskOutcome {
    ToStreamer,
    ToDonor,
}

impl TaskOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskOutcome::ToStreamer => "to_streamer",
            TaskOutcome::ToDonor => "to_donor",
        }
    }
}

/// Причины исхода, которые выдаёт tally (полный набор причин машины — в M2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TallyReason {
    NoQuorum,
    VoteCompleted,
    VoteNotCompleted,
    Tie,
}

impl TallyReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            TallyReason::NoQuorum => "no_quorum",
            TallyReason::VoteCompleted => "vote_completed",
            TallyReason::VoteNotCompleted => "vote_not_completed",
            TallyReason::Tie => "tie",
        }
    }
}

/// Изменение репутации за спор (micro-очки): +10 за подтверждённый, −50 инициатору за проигранный.
pub const DISPUTE_WIN_BONUS_MICRO: i128 = 10_000_000;
pub const DISPUTE_LOSS_PENALTY_MICRO: i128 = 50_000_000;

/// Порт `tally`: кворум по СУММЕ весов включительно (сумма == кворум → голоса считаются);
/// ничья и недобор кворума → стримеру (презумпция, спека §11).
pub fn tally(votes: &[Vote], quorum_micro: i128) -> (TaskOutcome, TallyReason) {
    let mut completed: i128 = 0;
    let mut not: i128 = 0;
    for v in votes {
        match v.choice {
            VoteChoice::Completed => completed += v.weight_micro,
            VoteChoice::NotCompleted => not += v.weight_micro,
        }
    }
    if completed + not < quorum_micro {
        return (TaskOutcome::ToStreamer, TallyReason::NoQuorum);
    }
    if completed > not {
        (TaskOutcome::ToStreamer, TallyReason::VoteCompleted)
    } else if not > completed {
        (TaskOutcome::ToDonor, TallyReason::VoteNotCompleted)
    } else {
        (TaskOutcome::ToStreamer, TallyReason::Tie)
    }
}
