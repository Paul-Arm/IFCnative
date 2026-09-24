//! Table import: rows from CSV/TSV/XLSX (or the clipboard) are matched to
//! objects through a key column and written to attributes and properties.
//! First computed as a plan (dry run), then applied in one step.

use crate::document::{tflags, Document};
use crate::{model, ops, Value};
use rustc_hash::FxHashMap;

#[derive(Debug, Clone, Default)]
pub struct ImportTable {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

impl ImportTable {
    pub fn is_empty(&self) -> bool {
        self.headers.is_empty()
    }

    /// Up to `n` distinct non-empty sample values of a column.
    pub fn samples(&self, col: usize, n: usize) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        for r in &self.rows {
            if let Some(v) = r.get(col).map(|s| s.as_str()).filter(|s| !s.is_empty()) {
                if !out.contains(&v) {
                    out.push(v);
                    if out.len() >= n {
                        break;
                    }
                }
            }
        }
        out
    }
}

// ------------------------------------------------------------------ parsing

/// Delimiter with the most occurrences in the header line (; Tab , |).
pub fn detect_delimiter(line: &str) -> char {
    let mut best = ';';
    let mut best_n = 0;
    for c in [';', '\t', ',', '|'] {
        let n = line.matches(c).count();
        if n > best_n {
            best = c;
            best_n = n;
        }
    }
    best
}

/// CSV/TSV with quotes; the delimiter is detected from the first line if not given.
pub fn parse_delimited(text: &str, delimiter: Option<char>) -> ImportTable {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let delim = delimiter.unwrap_or_else(|| detect_delimiter(first));
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        if c == '"' && field.trim().is_empty() {
            field.clear();
            quoted = true;
        } else if c == delim {
            row.push(std::mem::take(&mut field));
        } else if c == '\n' {
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
        } else {
            field.push(c);
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    from_rows(rows)
}

/// Rows of a sheet: first non-empty row is the header.
pub fn from_rows(rows: Vec<Vec<String>>) -> ImportTable {
    let mut cleaned: Vec<Vec<String>> = rows.into_iter().map(|r| r.into_iter().map(|c| c.trim().to_string()).collect::<Vec<_>>()).filter(|r| r.iter().any(|c| !c.is_empty())).collect();
    if cleaned.is_empty() {
        return ImportTable::default();
    }
    let width = cleaned.iter().map(|r| r.len()).max().unwrap_or(0);
    let mut headers = cleaned.remove(0);
    headers.resize(width, String::new());
    // drop trailing columns that are empty everywhere
    let mut w = width;
    while w > 0 && headers[w - 1].is_empty() && cleaned.iter().all(|r| r.get(w - 1).map(|c| c.is_empty()).unwrap_or(true)) {
        w -= 1;
    }
    headers.truncate(w);
    for (i, h) in headers.iter_mut().enumerate() {
        if h.is_empty() {
            *h = format!("Spalte {}", i + 1);
        }
    }
    for r in &mut cleaned {
        r.resize(w, String::new());
    }
    ImportTable { headers, rows: cleaned }
}

fn is_spreadsheet(path: &std::path::Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("xlsx" | "xlsm" | "xlsb" | "xls" | "ods"))
}

/// Sheet names of a workbook (empty for text files).
pub fn sheet_names(path: &std::path::Path) -> anyhow::Result<Vec<String>> {
    use calamine::Reader;
    if !is_spreadsheet(path) {
        return Ok(Vec::new());
    }
    let wb = calamine::open_workbook_auto(path)?;
    Ok(wb.sheet_names())
}

/// Read a CSV/TSV/TXT or workbook file (`sheet` = None → first sheet).
pub fn read_file(path: &std::path::Path, sheet: Option<&str>, delimiter: Option<char>) -> anyhow::Result<ImportTable> {
    use calamine::Reader;
    if is_spreadsheet(path) {
        let mut wb = calamine::open_workbook_auto(path)?;
        let name = match sheet {
            Some(s) => s.to_string(),
            None => wb.sheet_names().first().cloned().ok_or_else(|| anyhow::anyhow!("Arbeitsmappe ohne Blätter"))?,
        };
        let range = wb.worksheet_range(&name)?;
        let rows = range.rows().map(|r| r.iter().map(cell_text).collect()).collect();
        return Ok(from_rows(rows));
    }
    let bytes = std::fs::read(path)?;
    Ok(parse_delimited(&decode_text(&bytes), delimiter))
}

fn cell_text(d: &calamine::Data) -> String {
    match d {
        calamine::Data::Float(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", *f as i64),
        calamine::Data::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        other => other.to_string(),
    }
}

/// UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252.
pub fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let le = bytes[0] == 0xff;
        let units: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
        return String::from_utf16_lossy(&units);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| cp1252(b)).collect(),
    }
}

fn cp1252(b: u8) -> char {
    const HI: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9f => HI[(b - 0x80) as usize],
        _ => b as char,
    }
}

// ------------------------------------------------------------------ mapping

/// Where a column's values go.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Target {
    Ignore,
    /// Direct entity attribute (Name, Description, ObjectType, Tag, LongName, PredefinedType).
    Attr(String),
    /// Property (or quantity) in a set: (set name, property name).
    Prop(String, String),
}

impl Target {
    pub fn label(&self) -> String {
        match self {
            Target::Ignore => "–".into(),
            Target::Attr(a) => a.clone(),
            Target::Prop(p, n) => format!("{p}.{n}"),
        }
    }
}

/// Set name meaning "the set that already holds the property, else Pset_<Class>Common".
pub const ANY_SET: &str = "*";

/// Standard common pset name of a class (IfcWallStandardCase → Pset_WallCommon).
pub fn common_pset_name(doc: &Document, id: u32) -> String {
    let camel = doc.type_camel(id).unwrap_or("IfcElement");
    let base = camel.trim_start_matches("Ifc").trim_end_matches("StandardCase").trim_end_matches("ElementedCase");
    let base = base.strip_suffix("Type").filter(|_| doc.has_flag(id, tflags::TYPE_OBJECT)).unwrap_or(base);
    format!("Pset_{base}Common")
}

pub const ATTRIBUTES: [&str; 6] = ["Name", "Description", "ObjectType", "Tag", "LongName", "PredefinedType"];

/// How key values find objects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum KeyKind {
    GlobalId,
    StepId,
    Name,
    Tag,
}

impl KeyKind {
    pub const ALL: [KeyKind; 4] = [KeyKind::GlobalId, KeyKind::StepId, KeyKind::Tag, KeyKind::Name];

    pub fn label(self) -> &'static str {
        match self {
            KeyKind::GlobalId => "GlobalId",
            KeyKind::StepId => "#STEP-Id",
            KeyKind::Name => "Name",
            KeyKind::Tag => "Tag (Kennung)",
        }
    }
}

fn norm_header(h: &str) -> String {
    h.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Objects that can be addressed by the import (rooted objects: products, types, …).
pub struct KeyIndex {
    objects: rustc_hash::FxHashSet<u32>,
    guid: FxHashMap<String, u32>,
    guid_ci: FxHashMap<String, Vec<u32>>,
    name: FxHashMap<String, Vec<u32>>,
    tag: FxHashMap<String, Vec<u32>>,
}

impl KeyIndex {
    pub fn build(doc: &Document) -> Self {
        let mut ix = KeyIndex { objects: rustc_hash::FxHashSet::default(), guid: FxHashMap::default(), guid_ci: FxHashMap::default(), name: FxHashMap::default(), tag: FxHashMap::default() };
        let tag_types: rustc_hash::FxHashSet<u32> = doc.ids_with_flag(tflags::ELEMENT).into_iter().collect();
        for id in doc.ids_with_flag(tflags::ROOT) {
            if doc.has_flag(id, tflags::REL) || doc.has_flag(id, tflags::PSET) || doc.has_flag(id, tflags::QSET) {
                continue;
            }
            ix.objects.insert(id);
            if let Some(g) = doc.guid_of(id) {
                ix.guid_ci.entry(g.to_lowercase()).or_default().push(id);
                ix.guid.insert(g, id);
            }
            if let Some(n) = doc.name_of(id).filter(|n| !n.trim().is_empty()) {
                ix.name.entry(n.trim().to_lowercase()).or_default().push(id);
            }
            if tag_types.contains(&id) {
                if let Some(t) = doc.attr(id, "Tag").and_then(|v| v.as_str().map(|s| s.trim().to_lowercase())).filter(|t| !t.is_empty()) {
                    ix.tag.entry(t).or_default().push(id);
                }
            }
        }
        ix
    }

    pub fn lookup(&self, doc: &Document, kind: KeyKind, key: &str) -> Vec<u32> {
        let k = key.trim();
        if k.is_empty() {
            return Vec::new();
        }
        match kind {
            KeyKind::GlobalId => match self.guid.get(k) {
                Some(&id) => vec![id],
                None => self.guid_ci.get(&k.to_lowercase()).cloned().unwrap_or_default(),
            },
            KeyKind::StepId => k.trim_start_matches('#').parse::<u32>().ok().filter(|id| self.objects.contains(id) && doc.exists(*id)).map(|id| vec![id]).unwrap_or_default(),
            KeyKind::Name => self.name.get(&k.to_lowercase()).cloned().unwrap_or_default(),
            KeyKind::Tag => self.tag.get(&k.to_lowercase()).cloned().unwrap_or_default(),
        }
    }
}

/// Automatic mapping of headers → targets and choice of the key column.
pub fn auto_map(doc: &Document, ix: &KeyIndex, table: &ImportTable) -> (Vec<Target>, Option<(usize, KeyKind)>) {
    // key: the column/kind pair that finds the most rows (header names break ties)
    let sample: Vec<&Vec<String>> = table.rows.iter().take(400).collect();
    let mut best: Option<(usize, KeyKind, usize, i32)> = None;
    for (c, h) in table.headers.iter().enumerate() {
        let nh = norm_header(h);
        for kind in KeyKind::ALL {
            let hits = sample.iter().filter(|r| !ix.lookup(doc, kind, &r[c]).is_empty()).count();
            if hits == 0 {
                continue;
            }
            let bonus = match (kind, nh.as_str()) {
                (KeyKind::StepId, "stepid" | "id" | "step" | "express" | "expressid") => 3,
                (KeyKind::GlobalId, "globalid" | "guid" | "ifcguid" | "globalidifc") => 3,
                (KeyKind::Tag, "tag" | "kennung") => 3,
                (KeyKind::Name, "name") => 1,
                (KeyKind::GlobalId, _) => 2,
                (KeyKind::StepId, _) => 0,
                _ => 0,
            };
            let better = match best {
                None => true,
                Some((_, _, bh, bb)) => hits > bh || (hits == bh && bonus > bb),
            };
            if better {
                best = Some((c, kind, hits, bonus));
            }
        }
    }
    let key = best.map(|(c, k, _, _)| (c, k));
    // known property names of matched objects (for bare headers)
    let mut known: Vec<(String, String)> = Vec::new();
    if let Some((kc, kk)) = key {
        let mut seen = rustc_hash::FxHashSet::default();
        for r in table.rows.iter().take(60) {
            for id in ix.lookup(doc, kk, &r[kc]).into_iter().take(2) {
                for ps in model::psets_of(doc, id) {
                    for p in ps.props {
                        if seen.insert((ps.name.clone(), p.name.clone())) {
                            known.push((ps.name.clone(), p.name));
                        }
                    }
                }
            }
        }
    }
    let targets = table
        .headers
        .iter()
        .enumerate()
        .map(|(c, h)| {
            if Some(c) == key.map(|k| k.0) {
                return Target::Ignore;
            }
            let nh = norm_header(h);
            match nh.as_str() {
                "stepid" | "globalid" | "guid" | "ifcguid" | "klasse" | "class" | "ifcclass" | "entity" | "typ" | "type" | "geschoss" | "storey" | "buildingstorey" | "material" | "id" => return Target::Ignore,
                "name" => return Target::Attr("Name".into()),
                "description" | "beschreibung" => return Target::Attr("Description".into()),
                "objecttype" | "objekttyp" => return Target::Attr("ObjectType".into()),
                "tag" | "kennung" => return Target::Attr("Tag".into()),
                "longname" | "langname" => return Target::Attr("LongName".into()),
                "predefinedtype" | "vordefiniertertyp" => return Target::Attr("PredefinedType".into()),
                _ => {}
            }
            if let Some((ps, p)) = h.split_once('.') {
                if !ps.trim().is_empty() && !p.trim().is_empty() {
                    return Target::Prop(ps.trim().to_string(), p.trim().to_string());
                }
            }
            let hits: Vec<&(String, String)> = known.iter().filter(|(_, p)| p.eq_ignore_ascii_case(h.trim()) || norm_header(p) == nh).collect();
            if let Some((ps, p)) = hits.first() {
                // several sets carry it (e.g. Pset_WallCommon / Pset_SlabCommon) → matching set per object
                // (class specific Pset_…Common sets as well)
                let class_specific = ps.starts_with("Pset_") && ps.ends_with("Common");
                let ps = if hits.iter().all(|(x, _)| x == ps) && !class_specific { ps.clone() } else { ANY_SET.to_string() };
                return Target::Prop(ps, p.clone());
            }
            Target::Ignore
        })
        .collect();
    (targets, key)
}

// ------------------------------------------------------------------ plan

#[derive(Debug, Clone, Copy)]
pub struct ImportOptions {
    /// Empty cells clear existing values (otherwise they are skipped).
    pub overwrite_with_empty: bool,
    /// Keys matching several objects update all of them (otherwise the row is skipped).
    pub all_matches: bool,
    /// Keep the data type of existing properties.
    pub keep_types: bool,
    /// Give objects sharing a property set their own copy before writing.
    pub split_shared: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        ImportOptions { overwrite_with_empty: false, all_matches: true, keep_types: true, split_shared: true }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowStatus {
    Update,
    Unchanged,
    NotFound,
    Ambiguous,
    NoKey,
}

impl RowStatus {
    pub fn label(self) -> &'static str {
        match self {
            RowStatus::Update => "Änderung",
            RowStatus::Unchanged => "unverändert",
            RowStatus::NotFound => "nicht gefunden",
            RowStatus::Ambiguous => "mehrdeutig",
            RowStatus::NoKey => "ohne Schlüssel",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CellChange {
    pub id: u32,
    pub col: usize,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone)]
pub struct PlanRow {
    pub index: usize,
    pub key: String,
    pub ids: Vec<u32>,
    pub status: RowStatus,
    pub changes: Vec<CellChange>,
}

#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub rows: Vec<PlanRow>,
    pub updates: usize,
    pub unchanged: usize,
    pub not_found: usize,
    pub ambiguous: usize,
    pub no_key: usize,
    pub changed_cells: usize,
    pub objects: usize,
}

/// Current value of a target on an object (occurrence value first, then type value).
pub fn current_value(doc: &Document, id: u32, t: &Target) -> String {
    let psets = if matches!(t, Target::Prop(..)) { model::psets_of(doc, id) } else { Vec::new() };
    value_in(doc, id, t, &psets)
}

fn value_in(doc: &Document, id: u32, t: &Target, psets: &[model::PsetView]) -> String {
    match t {
        Target::Ignore => String::new(),
        Target::Attr(a) => doc.attr(id, a).map(|v| v.display()).unwrap_or_default(),
        Target::Prop(ps, p) => psets.iter().filter(|s| ps == ANY_SET || &s.name == ps).flat_map(|s| s.props.iter()).find(|x| &x.name == p).map(|x| x.value.display()).unwrap_or_default(),
    }
}

/// Value equality tolerant to number formatting and boolean spellings.
pub fn same_value(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim(), b.trim());
    if a == b {
        return true;
    }
    if let (Ok(x), Ok(y)) = (a.replace(',', ".").parse::<f64>(), b.replace(',', ".").parse::<f64>()) {
        return (x - y).abs() <= 1e-9 * x.abs().max(y.abs()).max(1.0);
    }
    let bool_of = |s: &str| match s.to_ascii_lowercase().as_str() {
        "true" | "wahr" | "ja" | "yes" | ".t." => Some(true),
        "false" | "falsch" | "nein" | "no" | ".f." => Some(false),
        _ => None,
    };
    if let (Some(x), Some(y)) = (bool_of(a), bool_of(b)) {
        return x == y;
    }
    false
}

pub fn plan(doc: &Document, ix: &KeyIndex, table: &ImportTable, targets: &[Target], key: Option<(usize, KeyKind)>, opts: &ImportOptions) -> Plan {
    use rayon::prelude::*;
    let cols: Vec<(usize, &Target)> = targets.iter().enumerate().filter(|(c, t)| **t != Target::Ignore && Some(*c) != key.map(|k| k.0)).collect();
    let need_psets = cols.iter().any(|(_, t)| matches!(t, Target::Prop(..)));
    let rows: Vec<PlanRow> = table
        .rows
        .par_iter()
        .enumerate()
        .map(|(index, row)| {
            let key_text = key.and_then(|(c, _)| row.get(c)).cloned().unwrap_or_default();
            let ids = key.map(|(_, k)| ix.lookup(doc, k, &key_text)).unwrap_or_default();
            let status = if key_text.trim().is_empty() {
                RowStatus::NoKey
            } else if ids.is_empty() {
                RowStatus::NotFound
            } else if ids.len() > 1 && !opts.all_matches {
                RowStatus::Ambiguous
            } else {
                RowStatus::Unchanged
            };
            let mut pr = PlanRow { index, key: key_text, ids, status, changes: Vec::new() };
            if status == RowStatus::Unchanged {
                for &id in &pr.ids {
                    let psets = if need_psets { model::psets_of(doc, id) } else { Vec::new() };
                    for &(c, t) in &cols {
                        let to = row.get(c).map(|s| s.trim()).unwrap_or("");
                        if to.is_empty() && !opts.overwrite_with_empty {
                            continue;
                        }
                        if let Target::Attr(a) = t {
                            // attribute not defined for this class → nothing to write
                            if doc.schema().attr_index(doc.type_name(id).unwrap_or(""), a).is_none() {
                                continue;
                            }
                        }
                        let from = value_in(doc, id, t, &psets);
                        if same_value(&from, to) {
                            continue;
                        }
                        pr.changes.push(CellChange { id, col: c, from, to: to.to_string() });
                    }
                }
                if !pr.changes.is_empty() {
                    pr.status = RowStatus::Update;
                }
            }
            pr
        })
        .collect();
    let mut plan = Plan::default();
    let mut touched = rustc_hash::FxHashSet::default();
    for pr in &rows {
        match pr.status {
            RowStatus::Update => plan.updates += 1,
            RowStatus::Unchanged => plan.unchanged += 1,
            RowStatus::NotFound => plan.not_found += 1,
            RowStatus::Ambiguous => plan.ambiguous += 1,
            RowStatus::NoKey => plan.no_key += 1,
        }
        plan.changed_cells += pr.changes.len();
        touched.extend(pr.changes.iter().map(|c| c.id));
    }
    plan.objects = touched.len();
    plan.rows = rows;
    plan
}

fn quantity_kind(name: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    if n.contains("volume") || n.contains("volumen") {
        "VOLUME"
    } else if n.contains("area") || n.contains("fläche") || n.contains("flaeche") {
        "AREA"
    } else if n.contains("weight") || n.contains("mass") || n.contains("gewicht") {
        "WEIGHT"
    } else if n.contains("count") || n.contains("anzahl") {
        "COUNT"
    } else if n.contains("time") || n.contains("dauer") {
        "TIME"
    } else {
        "LENGTH"
    }
}

/// Write one value (empty text clears it).
pub fn write_value(doc: &mut Document, id: u32, t: &Target, text: &str, opts: &ImportOptions) -> anyhow::Result<()> {
    let text = text.trim();
    match t {
        Target::Ignore => Ok(()),
        Target::Attr(a) => {
            let ty = doc.type_name(id).unwrap_or("").to_string();
            if doc.schema().attr_index(&ty, a).is_none() {
                return Ok(()); // attribute not defined for this class
            }
            let v = if text.is_empty() {
                Value::Null
            } else if a == "PredefinedType" {
                Value::Enum(text.trim_matches('.').to_ascii_uppercase())
            } else {
                Value::Str(text.to_string())
            };
            doc.set_attr(id, a, v)
        }
        Target::Prop(ps, p) if ps == ANY_SET => {
            let holder = model::psets_of(doc, id).into_iter().find(|s| s.props.iter().any(|x| &x.name == p)).map(|s| s.name);
            let name = holder.unwrap_or_else(|| common_pset_name(doc, id));
            write_value(doc, id, &Target::Prop(name, p.clone()), text, opts)
        }
        Target::Prop(ps, p) => {
            let existing = ops::find_pset(doc, id, ps);
            let is_qto = match existing {
                Some((s, _, _)) => doc.type_name(s) == Some("IFCELEMENTQUANTITY"),
                None => ps.starts_with("Qto_") || ps.starts_with("BaseQuantities"),
            };
            if text.is_empty() {
                if let Some((s, _, _)) = existing {
                    let li = if is_qto { 5 } else { 4 };
                    let prop = doc.arg(s, li).map(|v| v.ref_list()).unwrap_or_default().into_iter().find(|&x| doc.arg(x, 0).and_then(|v| v.as_str().map(|s| s == p)).unwrap_or(false));
                    if let Some(prop) = prop {
                        ops::remove_property(doc, s, prop)?;
                    }
                }
                return Ok(());
            }
            if is_qto {
                if let Ok(f) = text.replace(',', ".").parse::<f64>() {
                    let kind = existing
                        .and_then(|(s, _, _)| doc.arg(s, 5).map(|v| v.ref_list()).unwrap_or_default().into_iter().find(|&x| doc.arg(x, 0).and_then(|v| v.as_str().map(|s| s == p)).unwrap_or(false)))
                        .and_then(|q| doc.type_name(q).map(|t| t.trim_start_matches("IFCQUANTITY").to_string()))
                        .unwrap_or_else(|| quantity_kind(p).to_string());
                    return ops::set_quantity(doc, id, ps, p, &kind, f);
                }
            }
            let hint = if opts.keep_types {
                model::psets_of(doc, id).into_iter().filter(|s| &s.name == ps).flat_map(|s| s.props).find(|x| &x.name == p).map(|x| match x.value {
                    Value::List(mut l) if !l.is_empty() => l.remove(0),
                    v => v,
                })
            } else {
                None
            };
            let v = ops::typed_value_from_text(text, hint.as_ref().filter(|v| matches!(v, Value::Typed(..))));
            ops::set_property(doc, id, ps, p, v, opts.split_shared)
        }
    }
}

/// Apply a plan; returns the number of written cells.
pub fn apply(doc: &mut Document, plan: &Plan, targets: &[Target], opts: &ImportOptions) -> anyhow::Result<usize> {
    let mut n = 0;
    for r in plan.rows.iter().filter(|r| r.status == RowStatus::Update) {
        for ch in &r.changes {
            if let Some(t) = targets.get(ch.col) {
                write_value(doc, ch.id, t, &ch.to, opts)?;
                n += 1;
            }
        }
    }
    Ok(n)
}

/// Write a generic table as CSV (semicolon separated, UTF-8 with BOM for Excel).
pub fn write_csv_rows(headers: &[String], rows: &[Vec<String>], path: &std::path::Path) -> anyhow::Result<()> {
    std::fs::write(path, format!("\u{feff}{}", to_delimited(headers, rows, ';')))?;
    Ok(())
}

pub fn to_delimited(headers: &[String], rows: &[Vec<String>], delim: char) -> String {
    let esc = |s: &str| {
        if s.contains(delim) || s.contains('"') || s.contains('\n') {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    };
    let mut out = String::new();
    let d = delim.to_string();
    out.push_str(&headers.iter().map(|h| esc(h)).collect::<Vec<_>>().join(&d));
    out.push('\n');
    for r in rows {
        out.push_str(&r.iter().map(|c| esc(c)).collect::<Vec<_>>().join(&d));
        out.push('\n');
    }
    out
}

/// Write a generic table as XLSX (numbers as numbers, header bold, autofilter).
pub fn write_xlsx_rows(sheet: &str, headers: &[String], rows: &[Vec<String>], path: &std::path::Path) -> anyhow::Result<()> {
    let mut wb = rust_xlsxwriter::Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name(sheet)?;
    let bold = rust_xlsxwriter::Format::new().set_bold();
    for (c, name) in headers.iter().enumerate() {
        ws.write_string_with_format(0, c as u16, name, &bold)?;
    }
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            match v.parse::<f64>() {
                Ok(f) if !v.starts_with('#') && f.is_finite() => ws.write_number((r + 1) as u32, c as u16, f)?,
                _ => ws.write_string((r + 1) as u32, c as u16, v)?,
            };
        }
    }
    if !headers.is_empty() {
        ws.autofilter(0, 0, rows.len() as u32, (headers.len() - 1) as u16)?;
    }
    ws.set_freeze_panes(1, 0)?;
    wb.save(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_csv_quotes_and_delimiters() {
        let t = parse_delimited("\u{feff}Name;\"Pset.A\";B\r\nx;\"a;b\";\"q\"\"\"\r\n\r\ny;2;\n", None);
        assert_eq!(t.headers, vec!["Name", "Pset.A", "B"]);
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.rows[0], vec!["x", "a;b", "q\""]);
        assert_eq!(t.rows[1], vec!["y", "2", ""]);
        let t = parse_delimited("a\tb\n1\t2", None);
        assert_eq!(t.rows[0], vec!["1", "2"]);
    }

    #[test]
    fn value_equality() {
        assert!(same_value("3,50", "3.5"));
        assert!(same_value("TRUE", "ja"));
        assert!(!same_value("a", "b"));
    }

    #[test]
    fn roundtrip_import() {
        let src = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('','',(''),(''),'','','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCWALL('0abcdefghijklmnopqrstu',$,'W1',$,$,$,$,$,$);\n#2=IFCWALL('1abcdefghijklmnopqrstu',$,'W2',$,$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;\n";
        let mut doc = Document::from_bytes(src.as_bytes().to_vec(), &|_, _| {}).unwrap();
        let ix = KeyIndex::build(&doc);
        let table = parse_delimited("GlobalId;Name;Pset_WallCommon.FireRating;Qto_WallBaseQuantities.Length\n0abcdefghijklmnopqrstu;Wand 1;F90;4,5\nxyz;W;F30;1\n", None);
        let (targets, key) = auto_map(&doc, &ix, &table);
        assert_eq!(key, Some((0, KeyKind::GlobalId)));
        assert_eq!(targets[1], Target::Attr("Name".into()));
        assert_eq!(targets[2], Target::Prop("Pset_WallCommon".into(), "FireRating".into()));
        let opts = ImportOptions::default();
        let p = plan(&doc, &ix, &table, &targets, key, &opts);
        assert_eq!(p.updates, 1);
        assert_eq!(p.not_found, 1);
        assert_eq!(p.changed_cells, 3);
        apply(&mut doc, &p, &targets, &opts).unwrap();
        assert_eq!(doc.name_of(1).as_deref(), Some("Wand 1"));
        assert_eq!(current_value(&doc, 1, &targets[2]), "F90");
        assert_eq!(current_value(&doc, 1, &targets[3]), "4.5");
        let p2 = plan(&doc, &ix, &table, &targets, key, &opts);
        assert_eq!(p2.updates, 0);
        assert_eq!(p2.unchanged, 1);
    }

    #[test]
    fn any_set_target() {
        let src = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('','',(''),(''),'','','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCWALLSTANDARDCASE('0abcdefghijklmnopqrstu',$,'W1',$,$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;\n";
        let mut doc = Document::from_bytes(src.as_bytes().to_vec(), &|_, _| {}).unwrap();
        assert_eq!(common_pset_name(&doc, 1), "Pset_WallCommon");
        let t = Target::Prop(ANY_SET.into(), "FireRating".into());
        write_value(&mut doc, 1, &t, "F90", &ImportOptions::default()).unwrap();
        assert_eq!(current_value(&doc, 1, &Target::Prop("Pset_WallCommon".into(), "FireRating".into())), "F90");
        assert_eq!(current_value(&doc, 1, &t), "F90");
    }
}
