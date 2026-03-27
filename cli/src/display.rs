use console::Style;
use indicatif::{ProgressBar, ProgressStyle};

use crate::client::SubsetResult;

/// Create a progress bar for batch processing.
pub fn make_progress(total: u64) -> ProgressBar {
    let pb = ProgressBar::new(total);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.magenta} [{bar:30.magenta/dim}] {pos}/{len} {msg}")
            .unwrap()
            .progress_chars("━╸─"),
    );
    pb
}

/// Print result for a single file.
pub fn print_result(result: &SubsetResult) {
    let ok_style = Style::new().green().bold();
    let warn_style = Style::new().yellow().bold();
    let err_style = Style::new().red().bold();
    let dim = Style::new().dim();

    match result.code {
        200 => {
            let size = result
                .data
                .as_ref()
                .map(|d| format_size(d.len()))
                .unwrap_or_default();
            println!(
                "  {} {} {}",
                ok_style.apply_to("✓"),
                result.filename,
                dim.apply_to(format!("({})", size)),
            );
        }
        201 => {
            let size = result
                .data
                .as_ref()
                .map(|d| format_size(d.len()))
                .unwrap_or_default();
            println!(
                "  {} {} {}",
                warn_style.apply_to("⚠"),
                result.filename,
                dim.apply_to(format!("({})", size)),
            );
            for msg in &result.messages {
                println!("    {}", dim.apply_to(msg));
            }
        }
        _ => {
            println!(
                "  {} {} [code {}]",
                err_style.apply_to("✗"),
                result.filename,
                result.code,
            );
            for msg in &result.messages {
                println!("    {}", err_style.apply_to(msg));
            }
        }
    }
}

/// Print summary after all files processed.
pub fn print_summary(results: &[SubsetResult]) {
    let ok_style = Style::new().green().bold();
    let warn_style = Style::new().yellow().bold();
    let err_style = Style::new().red().bold();
    let dim = Style::new().dim();

    let ok = results.iter().filter(|r| r.code == 200).count();
    let warn = results.iter().filter(|r| r.code == 201).count();
    let fail = results.iter().filter(|r| r.code >= 300).count();

    println!();
    println!(
        "  {} {} ok  {} {} warn  {} {} fail  {} {} total",
        ok_style.apply_to("●"),
        ok,
        warn_style.apply_to("●"),
        warn,
        err_style.apply_to("●"),
        fail,
        dim.apply_to("●"),
        results.len(),
    );
}

fn format_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}
