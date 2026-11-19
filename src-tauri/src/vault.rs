use chrono::{DateTime, Local};
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// Formats one inbox line: a plain bullet for notes, a task with ⏰ for reminders.
pub fn format_line(now: DateTime<Local>, text: &str, due: Option<DateTime<Local>>) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let time = now.format("%H:%M");
    match due {
        Some(due) => format!("- [ ] {time} {text} ⏰ {}", due.format("%Y-%m-%d %H:%M")),
        None => format!("- {time} {text}"),
    }
}

/// Appends a line to `<vault>/<folder>/YYYY-MM-DD.md`, creating folders and file as needed.
pub fn append_entry(
    vault: &Path,
    folder: &str,
    now: DateTime<Local>,
    text: &str,
    due: Option<DateTime<Local>>,
) -> io::Result<PathBuf> {
    let dir = vault.join(folder);
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.md", now.format("%Y-%m-%d")));

    let mut file = OpenOptions::new().create(true).read(true).append(true).open(&path)?;
    let len = file.metadata()?.len();
    let mut needs_newline = false;
    if len > 0 {
        let mut last = [0u8; 1];
        file.seek(SeekFrom::End(-1))?;
        file.read_exact(&mut last)?;
        needs_newline = last[0] != b'\n';
    }
    let prefix = if needs_newline { "\n" } else { "" };
    writeln!(file, "{prefix}{}", format_line(now, text, due))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(h: u32, m: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, 19, h, m, 0).unwrap()
    }

    #[test]
    fn formats_note_and_reminder_lines() {
        assert_eq!(format_line(at(20, 31), "мысль  про\nидею", None), "- 20:31 мысль про идею");
        assert_eq!(
            format_line(at(20, 35), "Созвон", Some(at(22, 0))),
            "- [ ] 20:35 Созвон ⏰ 2026-11-19 22:00"
        );
    }

    #[test]
    fn appends_to_daily_file_and_fixes_missing_newline() {
        let vault = std::env::temp_dir().join(format!("notifyer-test-{}", std::process::id()));
        let file = vault.join("Входящие").join("2026-11-19.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "# Существующее").unwrap();

        append_entry(&vault, "Входящие", at(9, 5), "раз", None).unwrap();
        append_entry(&vault, "Входящие", at(9, 6), "два", None).unwrap();

        let content = fs::read_to_string(&file).unwrap();
        fs::remove_dir_all(&vault).unwrap();
        assert_eq!(content, "# Существующее\n- 09:05 раз\n- 09:06 два\n");
    }
}
