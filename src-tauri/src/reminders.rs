use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const MINUTE_MS: i64 = 60_000;
/// Heads-up popups older than this are skipped silently (e.g. the PC was off).
const MISSED_GRACE_MS: i64 = 2 * MINUTE_MS;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub text: String,
    /// Unix time in milliseconds.
    pub due: i64,
    /// Minutes before `due` when a heads-up is shown. The event itself always fires.
    pub offsets: Vec<u32>,
    #[serde(default)]
    pub fired: Vec<u32>,
}

/// One popup card.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Popup {
    pub id: String,
    pub text: String,
    pub due: i64,
    /// 0 for the event itself, otherwise minutes left.
    pub offset: u32,
}

/// Decides which offsets fire now and which are skipped. Pure, so it is unit-tested.
pub fn evaluate(r: &Reminder, now: i64) -> (Option<u32>, Vec<u32>) {
    if now >= r.due {
        let skipped = r.offsets.iter().copied().filter(|o| !r.fired.contains(o)).collect();
        return (Some(0), skipped);
    }
    let mut ready: Vec<u32> = r
        .offsets
        .iter()
        .copied()
        .filter(|o| !r.fired.contains(o) && now >= r.due - *o as i64 * MINUTE_MS)
        .collect();
    // Only the closest heads-up is worth showing; the rest are stale.
    ready.sort_unstable();
    let Some((&closest, rest)) = ready.split_first() else {
        return (None, vec![]);
    };
    let fire_at = r.due - closest as i64 * MINUTE_MS;
    if now - fire_at > MISSED_GRACE_MS {
        (None, ready)
    } else {
        (Some(closest), rest.to_vec())
    }
}

pub struct Store {
    path: PathBuf,
    items: Vec<Reminder>,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let items = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok())
            .unwrap_or_default();
        Self { path, items }
    }

    fn save(&self) {
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Err(e) = fs::write(&self.path, serde_json::to_string_pretty(&self.items).unwrap()) {
            eprintln!("failed to save reminders: {e}");
        }
    }

    pub fn add(&mut self, text: String, due: i64, mut offsets: Vec<u32>, now: i64) -> Reminder {
        // Heads-ups that would already be in the past make no sense for a new reminder.
        offsets.retain(|o| *o > 0 && due - *o as i64 * MINUTE_MS > now);
        offsets.sort_unstable_by(|a, b| b.cmp(a));
        offsets.dedup();
        let reminder = Reminder { id: new_id(), text, due, offsets, fired: vec![] };
        self.items.push(reminder.clone());
        self.save();
        reminder
    }

    pub fn remove(&mut self, id: &str) {
        self.items.retain(|r| r.id != id);
        self.save();
    }

    pub fn list(&self) -> Vec<Reminder> {
        let mut items = self.items.clone();
        items.sort_by_key(|r| r.due);
        items
    }

    /// Marks everything that is due as fired and returns the popups to show.
    pub fn tick(&mut self, now: i64) -> Vec<Popup> {
        let mut popups = vec![];
        let mut changed = false;
        for r in &mut self.items {
            let (fire, skip) = evaluate(r, now);
            if !skip.is_empty() {
                r.fired.extend(skip);
                changed = true;
            }
            if let Some(offset) = fire {
                if offset > 0 {
                    r.fired.push(offset);
                }
                popups.push(Popup { id: new_id(), text: r.text.clone(), due: r.due, offset });
                changed = true;
            }
        }
        let before = self.items.len();
        self.items.retain(|r| now < r.due);
        if changed || self.items.len() != before {
            self.save();
        }
        popups
    }
}

fn new_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{nanos:x}-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUE: i64 = 1_000 * MINUTE_MS;

    fn reminder(offsets: &[u32], fired: &[u32]) -> Reminder {
        Reminder {
            id: "r".into(),
            text: "t".into(),
            due: DUE,
            offsets: offsets.to_vec(),
            fired: fired.to_vec(),
        }
    }

    fn minutes_before(m: i64) -> i64 {
        DUE - m * MINUTE_MS
    }

    #[test]
    fn nothing_fires_early() {
        assert_eq!(evaluate(&reminder(&[60, 30, 5], &[]), minutes_before(61)), (None, vec![]));
    }

    #[test]
    fn heads_up_fires_on_time() {
        assert_eq!(evaluate(&reminder(&[60, 30, 5], &[]), minutes_before(60)), (Some(60), vec![]));
        assert_eq!(evaluate(&reminder(&[60, 30, 5], &[60]), minutes_before(30)), (Some(30), vec![]));
        assert_eq!(evaluate(&reminder(&[60, 30, 5], &[60, 30]), minutes_before(29)), (None, vec![]));
    }

    #[test]
    fn only_closest_heads_up_fires_when_several_are_ready() {
        // Woke up at 29.5 minutes before: 60 is stale, 30 is within grace.
        let now = minutes_before(30) + MINUTE_MS / 2;
        assert_eq!(evaluate(&reminder(&[60, 30, 5], &[]), now), (Some(30), vec![60]));
    }

    #[test]
    fn stale_heads_ups_are_skipped_silently() {
        assert_eq!(evaluate(&reminder(&[60, 30, 5], &[]), minutes_before(20)), (None, vec![30, 60]));
    }

    #[test]
    fn event_fires_and_skips_remaining_heads_ups() {
        assert_eq!(evaluate(&reminder(&[60, 30, 5], &[60]), DUE + 5 * MINUTE_MS), (Some(0), vec![30, 5]));
    }

    #[test]
    fn store_drops_past_offsets_and_removes_fired_reminders() {
        let path = std::env::temp_dir().join(format!("notifyer-reminders-{}.json", std::process::id()));
        let mut store = Store::load(path.clone());
        let r = store.add("t".into(), DUE, vec![5, 60, 30, 30], minutes_before(40));
        assert_eq!(r.offsets, vec![30, 5]);

        assert_eq!(store.tick(minutes_before(30)).len(), 1);
        assert_eq!(store.tick(minutes_before(30)).len(), 0);
        let popups = store.tick(DUE);
        assert_eq!(popups[0].offset, 0);
        assert!(store.list().is_empty());
        fs::remove_file(path).unwrap();
    }
}
