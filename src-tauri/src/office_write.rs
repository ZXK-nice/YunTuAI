//! 内置办公写回（xlsx / docx / csv），不依赖 Python 或 npm 包。

use serde::Deserialize;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use zip::ZipWriter;

fn xml_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn col_name(idx: usize) -> String {
    let mut n = idx + 1;
    let mut out = String::new();
    while n > 0 {
        let rem = (n - 1) % 26;
        out.insert(0, char::from_u32(b'A' as u32 + rem as u32).unwrap_or('A'));
        n = (n - 1) / 26;
    }
    out
}

pub fn sanitize_output_filename(name: &str, ext: &str) -> String {
    let base = name.trim();
    let lower = base.to_lowercase();
    let stem = if lower.ends_with(ext) {
        base[..base.len() - ext.len()].trim()
    } else {
        base
    };
    let cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c > '\u{007F}' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let stem = cleaned.trim_matches('_');
    if stem.is_empty() {
        format!("output{ext}")
    } else {
        format!("{stem}{ext}")
    }
}

fn zip_options() -> FileOptions<'static, ()> {
    FileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

fn write_zip_entry(zip: &mut ZipWriter<File>, path: &str, content: &str) -> Result<(), String> {
    zip.start_file(path, zip_options()).map_err(|e| e.to_string())?;
    zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn write_csv_rows(path: &Path, rows: &[Vec<String>]) -> Result<u64, String> {
    let mut file = File::create(path).map_err(|e| format!("无法创建 CSV：{e}"))?;
    for row in rows {
        let line = row
            .iter()
            .map(|cell| {
                let needs_quote = cell.contains(',') || cell.contains('"') || cell.contains('\n');
                if needs_quote {
                    format!("\"{}\"", cell.replace('"', "\"\""))
                } else {
                    cell.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(",");
        writeln!(file, "{line}").map_err(|e| format!("写入 CSV 失败：{e}"))?;
    }
    Ok(path.metadata().map_err(|e| e.to_string())?.len())
}

pub fn write_xlsx_rows(path: &Path, rows: &[Vec<String>]) -> Result<u64, String> {
    let file = File::create(path).map_err(|e| format!("无法创建 xlsx：{e}"))?;
    let mut zip = ZipWriter::new(file);

    let mut sheet_rows = String::new();
    for (r_idx, row) in rows.iter().enumerate() {
        let r = r_idx + 1;
        sheet_rows.push_str(&format!("<row r=\"{r}\">"));
        for (c_idx, cell) in row.iter().enumerate() {
            let col = col_name(c_idx);
            let ref_id = format!("{col}{r}");
            let escaped = xml_escape(cell);
            sheet_rows.push_str(&format!(
                "<c r=\"{ref_id}\" t=\"inlineStr\"><is><t>{escaped}</t></is></c>"
            ));
        }
        sheet_rows.push_str("</row>");
    }

    let sheet_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>{sheet_rows}</sheetData>
</worksheet>"#
    );

    write_zip_entry(
        &mut zip,
        "[Content_Types].xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "xl/workbook.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "xl/_rels/workbook.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "xl/styles.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font/></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs>
</styleSheet>"#,
    )?;
    write_zip_entry(&mut zip, "xl/worksheets/sheet1.xml", &sheet_xml)?;

    zip.finish().map_err(|e| format!("打包 xlsx 失败：{e}"))?;
    Ok(path.metadata().map_err(|e| e.to_string())?.len())
}

pub fn write_docx_paragraphs(path: &Path, paragraphs: &[String]) -> Result<u64, String> {
    let file = File::create(path).map_err(|e| format!("无法创建 docx：{e}"))?;
    let mut zip = ZipWriter::new(file);

    let body: String = paragraphs
        .iter()
        .map(|p| {
            let escaped = xml_escape(p);
            format!("<w:p><w:r><w:t xml:space=\"preserve\">{escaped}</w:t></w:r></w:p>")
        })
        .collect::<Vec<_>>()
        .join("");

    let document_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>{body}</w:body>
</w:document>"#
    );

    write_zip_entry(
        &mut zip,
        "[Content_Types].xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#,
    )?;
    write_zip_entry(&mut zip, "word/document.xml", &document_xml)?;

    zip.finish().map_err(|e| format!("打包 docx 失败：{e}"))?;
    Ok(path.metadata().map_err(|e| e.to_string())?.len())
}

#[derive(Debug, Deserialize)]
struct OfficeWriteJson {
    rows: Option<Vec<Vec<String>>>,
    paragraphs: Option<Vec<String>>,
}

pub fn write_office_output(
    format: &str,
    out_path: &Path,
    json: &str,
) -> Result<u64, String> {
    let payload: OfficeWriteJson =
        serde_json::from_str(json).map_err(|e| format!("JSON 格式无效：{e}"))?;
    let fmt = format.trim().to_lowercase();
    match fmt.as_str() {
        "csv" => {
            let rows = payload
                .rows
                .filter(|r| !r.is_empty())
                .ok_or_else(|| "csv 需要 rows 数组".to_string())?;
            write_csv_rows(out_path, &rows)
        }
        "xlsx" => {
            let rows = payload
                .rows
                .filter(|r| !r.is_empty())
                .ok_or_else(|| "xlsx 需要 rows 数组".to_string())?;
            write_xlsx_rows(out_path, &rows)
        }
        "docx" => {
            let paragraphs = payload
                .paragraphs
                .filter(|p| !p.is_empty())
                .ok_or_else(|| "docx 需要 paragraphs 数组".to_string())?;
            write_docx_paragraphs(out_path, &paragraphs)
        }
        other => Err(format!("不支持的格式：{other}（仅 csv / xlsx / docx）")),
    }
}

fn reserve_new_file(candidate: &Path) -> bool {
    if let Some(parent) = candidate.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(candidate)
        .is_ok()
}

pub fn allocate_unique_output_path(path: &Path) -> PathBuf {
    if reserve_new_file(path) {
        return path.to_path_buf();
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".into());
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    for n in 2..100 {
        let name = if ext.is_empty() {
            format!("{stem} ({n})")
        } else {
            format!("{stem} ({n}).{ext}")
        };
        let candidate = parent.join(name);
        if reserve_new_file(&candidate) {
            return candidate;
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    for extra in 0..32 {
        let name = if ext.is_empty() {
            format!("{stem}-{stamp}-{extra}")
        } else {
            format!("{stem}-{stamp}-{extra}.{ext}")
        };
        let candidate = parent.join(name);
        if reserve_new_file(&candidate) {
            return candidate;
        }
    }
    parent.join(if ext.is_empty() {
        format!("{stem}-{stamp}")
    } else {
        format!("{stem}-{stamp}.{ext}")
    })
}

fn assert_office_cli_output_allowed(out: &Path) -> Result<(), String> {
    let root = crate::chat_files::resolve_output_dir()?;
    let root = strip_cli_verbatim(&root.canonicalize().unwrap_or(root));
    let parent = out
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "输出路径无效".to_string())?;
    if !parent.is_dir() {
        return Err("输出目录不存在，且必须位于产出目录内".into());
    }
    let parent = strip_cli_verbatim(&parent.canonicalize().map_err(|e| format!("无法解析输出目录: {e}"))?);
    if !parent.starts_with(&root) {
        return Err("输出路径必须位于产出目录内".into());
    }
    Ok(())
}

fn strip_cli_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let trimmed = text.strip_prefix(r"\\?\").unwrap_or(&text);
    PathBuf::from(trimmed)
}

/// CLI：`YunTuAI.exe --yuntu-office-write <format> <outputPath> <jsonPath>`
pub fn try_run_office_write_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 || args[1] != "--yuntu-office-write" {
        return None;
    }
    let format = &args[2];
    let out = PathBuf::from(&args[3]);
    let json_path = if args.len() >= 5 {
        PathBuf::from(&args[4])
    } else {
        eprintln!("缺少 JSON 数据文件路径");
        return Some(2);
    };
    if let Err(e) = assert_office_cli_output_allowed(&out) {
        eprintln!("{e}");
        return Some(2);
    }
    if out.exists() {
        eprintln!("输出文件已存在，拒绝覆盖：{}", out.display());
        return Some(2);
    }
    let json = std::fs::read_to_string(&json_path).map_err(|e| e.to_string());
    match json {
        Ok(body) => match write_office_output(format, &out, &body) {
            Ok(size) => {
                println!("{size}");
                Some(0)
            }
            Err(e) => {
                eprintln!("{e}");
                Some(1)
            }
        },
        Err(e) => {
            eprintln!("{e}");
            Some(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("yuntu-office-{stamp}-{name}"))
    }

    #[test]
    fn writes_csv_and_xlsx_and_docx() {
        let csv = temp_path("out.csv");
        let xlsx = temp_path("out.xlsx");
        let docx = temp_path("out.docx");
        let rows = vec![
            vec!["姓名".into(), "金额".into()],
            vec!["张三".into(), "120".into()],
        ];
        assert!(write_csv_rows(&csv, &rows).unwrap() > 0);
        assert!(write_xlsx_rows(&xlsx, &rows).unwrap() > 0);
        assert!(
            write_docx_paragraphs(&docx, &["第一段".into(), "第二段".into()])
                .unwrap()
                > 0
        );
        let _ = std::fs::remove_file(csv);
        let _ = std::fs::remove_file(xlsx);
        let _ = std::fs::remove_file(docx);
    }
}
