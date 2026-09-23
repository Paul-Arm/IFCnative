//! Editable IFC document.
//!
//! Every entity is a 16 byte [`Rec`] pointing either into the original file
//! bytes (never copied) or into an append-only edit arena. Edits only swap
//! records, which makes undo/redo trivially cheap and keeps memory low even for
//! multi-gigabyte models. Arguments are parsed on demand.

use crate::schema::{Schema, SchemaId};
use crate::step::{self, parse_args, Value};
use rayon::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

pub const NO_IDX: u32 = u32::MAX;

const F_ARENA: u8 = 1;
const F_DELETED: u8 = 2;

/// Compact entity record (16 bytes).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(C)]
pub struct Rec {
    pub id: u32,
    len: u32,
    off_lo: u32,
    pub ty: u16,
    off_hi: u8,
    flags: u8,
}

impl Rec {
    fn new(id: u32, ty: u16, off: u64, len: u32, arena: bool) -> Rec {
        Rec { id, len, off_lo: off as u32, ty, off_hi: (off >> 32) as u8, flags: if arena { F_ARENA } else { 0 } }
    }
    #[inline]
    pub fn off(&self) -> u64 {
        self.off_lo as u64 | ((self.off_hi as u64) << 32)
    }
    #[inline]
    pub fn len(&self) -> usize {
        self.len as usize
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    #[inline]
    pub fn in_arena(&self) -> bool {
        self.flags & F_ARENA != 0
    }
    #[inline]
    pub fn deleted(&self) -> bool {
        self.flags & F_DELETED != 0
    }
    fn with_deleted(mut self, d: bool) -> Rec {
        if d {
            self.flags |= F_DELETED
        } else {
            self.flags &= !F_DELETED
        }
        self
    }
}

pub mod tflags {
    pub const PRODUCT: u32 = 1;
    pub const ELEMENT: u32 = 2;
    pub const SPATIAL: u32 = 4;
    pub const REL: u32 = 8;
    pub const PSET: u32 = 16;
    pub const QSET: u32 = 32;
    pub const TYPE_OBJECT: u32 = 64;
    pub const OPENING: u32 = 128;
    pub const ROOT: u32 = 256;
    pub const PROPERTY: u32 = 512;
    pub const QUANTITY: u32 = 1024;
    pub const GROUP: u32 = 2048;
    pub const MATERIAL: u32 = 4096;
    pub const REPR_ITEM: u32 = 8192;
    pub const PROJECT: u32 = 16384;
    pub const ANNOTATION: u32 = 32768;
    pub const FEATURE: u32 = 65536;
}

#[derive(Debug, Clone)]
pub struct TypeInfo {
    /// Upper case STEP keyword, e.g. `IFCWALL`.
    pub name: String,
    /// CamelCase name from the schema (or the keyword if unknown).
    pub camel: String,
    pub schema_idx: Option<usize>,
    pub flags: u32,
}

#[derive(Debug, Clone, Default)]
pub struct Header {
    pub description: Vec<String>,
    pub implementation_level: String,
    pub name: String,
    pub time_stamp: String,
    pub author: Vec<String>,
    pub organization: Vec<String>,
    pub preprocessor: String,
    pub originating_system: String,
    pub authorization: String,
    pub schema: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub severity: Severity,
    pub entity: Option<u32>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

enum IdMap {
    Dense(Vec<u32>),
    Sparse(FxHashMap<u32, u32>),
}

impl IdMap {
    #[inline]
    fn get(&self, id: u32) -> u32 {
        match self {
            IdMap::Dense(v) => v.get(id as usize).copied().unwrap_or(NO_IDX),
            IdMap::Sparse(m) => m.get(&id).copied().unwrap_or(NO_IDX),
        }
    }
    fn insert(&mut self, id: u32, idx: u32) {
        match self {
            IdMap::Dense(v) => {
                let i = id as usize;
                if i >= v.len() {
                    if i > v.len() * 4 + 1_000_000 {
                        let mut m: FxHashMap<u32, u32> = FxHashMap::default();
                        for (k, &x) in v.iter().enumerate() {
                            if x != NO_IDX {
                                m.insert(k as u32, x);
                            }
                        }
                        m.insert(id, idx);
                        *self = IdMap::Sparse(m);
                        return;
                    }
                    v.resize(i + 1, NO_IDX);
                }
                v[i] = idx;
            }
            IdMap::Sparse(m) => {
                m.insert(id, idx);
            }
        }
    }
}

#[derive(Default)]
struct InverseIndex {
    offsets: Vec<u32>,
    data: Vec<u32>,
    added: FxHashMap<u32, Vec<u32>>,
    removed: FxHashSet<(u32, u32)>,
}

impl InverseIndex {
    fn get(&self, target: u32) -> Vec<u32> {
        let mut out: Vec<u32> = Vec::new();
        let t = target as usize;
        if t + 1 < self.offsets.len() {
            let s = &self.data[self.offsets[t] as usize..self.offsets[t + 1] as usize];
            if self.removed.is_empty() {
                out.extend_from_slice(s);
            } else {
                out.extend(s.iter().copied().filter(|&src| !self.removed.contains(&(src, target))));
            }
        }
        if let Some(a) = self.added.get(&target) {
            out.extend_from_slice(a);
        }
        out
    }
    fn apply_diff(&mut self, src: u32, old: &[u32], new: &[u32]) {
        for &t in old {
            if !new.contains(&t) {
                let mut in_added = false;
                if let Some(a) = self.added.get_mut(&t) {
                    if let Some(p) = a.iter().position(|&x| x == src) {
                        a.swap_remove(p);
                        in_added = true;
                    }
                }
                if !in_added {
                    self.removed.insert((src, t));
                }
            }
        }
        for &t in new {
            if !old.contains(&t) {
                if !self.removed.remove(&(src, t)) {
                    self.added.entry(t).or_default().push(src);
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct Change {
    pub idx: u32,
    pub before: Rec,
    pub after: Rec,
}

#[derive(Debug, Clone)]
pub struct Transaction {
    pub label: String,
    pub changes: Vec<Change>,
    pub time: std::time::SystemTime,
}

impl Transaction {
    /// Ids of entities touched by this transaction.
    pub fn touched_ids(&self, doc: &Document) -> Vec<u32> {
        let mut v: Vec<u32> = self.changes.iter().map(|c| doc.recs[c.idx as usize].id).collect();
        v.sort_unstable();
        v.dedup();
        v
    }
}

pub struct LoadStats {
    pub bytes: usize,
    pub entities: usize,
    pub scan_ms: f64,
    pub index_ms: f64,
    pub total_ms: f64,
}

pub struct Document {
    pub path: Option<PathBuf>,
    pub header: Header,
    pub schema_id: SchemaId,
    src: Arc<Vec<u8>>,
    arena: Vec<u8>,
    recs: Vec<Rec>,
    pub types: Vec<TypeInfo>,
    type_by_name: FxHashMap<String, u16>,
    by_type: Vec<Vec<u32>>,
    ids: IdMap,
    inv: InverseIndex,
    max_id: u32,
    pub diagnostics: Vec<Diagnostic>,
    undo: Vec<Transaction>,
    redo: Vec<Transaction>,
    current: Option<Transaction>,
    save_point: Option<usize>,
    revision: u64,
    pub load_stats: Option<LoadStats>,
    /// Ids whose geometry-relevant state changed since last drained (for incremental re-meshing).
    changed_ids: Vec<u32>,
}

pub type Progress<'a> = &'a (dyn Fn(f32, &str) + Sync);

impl Document {
    // ------------------------------------------------------------------ loading

    pub fn open(path: &Path, progress: Progress) -> anyhow::Result<Document> {
        progress(0.0, "Datei wird gelesen …");
        let bytes = std::fs::read(path)?;
        let bytes = if path.extension().map(|e| e.eq_ignore_ascii_case("ifczip")).unwrap_or(false) || bytes.starts_with(b"PK\x03\x04") {
            crate::io::unzip_ifc(&bytes)?
        } else {
            bytes
        };
        let mut doc = Document::from_bytes(bytes, progress)?;
        doc.path = Some(path.to_path_buf());
        Ok(doc)
    }

    pub fn from_bytes(bytes: Vec<u8>, progress: Progress) -> anyhow::Result<Document> {
        let t0 = std::time::Instant::now();
        let b = &bytes[..];
        let data_pos = find_data_section(b).ok_or_else(|| anyhow::anyhow!("Keine DATA-Sektion gefunden – keine gültige IFC/STEP-Datei"))?;
        let header = parse_header(&b[..data_pos]);
        let schema_label = header.schema.first().cloned().unwrap_or_else(|| "IFC4".into());
        let schema_id = SchemaId::from_header(&schema_label);
        progress(0.05, "Datensätze werden gelesen …");

        // parallel chunked scan with boundary verification
        let data_end = b.len();
        let span = data_end - data_pos;
        let threads = rayon::current_num_threads().max(1);
        let n_chunks = if span < 4 << 20 { 1 } else { (threads * 4).min(span / (1 << 20)).max(1) };
        let mut bounds = Vec::with_capacity(n_chunks + 1);
        bounds.push(data_pos);
        for k in 1..n_chunks {
            let raw = data_pos + span * k / n_chunks;
            let prev = *bounds.last().unwrap();
            let a = step::align_to_record(b, raw.max(prev), data_end);
            if a > prev && a < data_end {
                bounds.push(a);
            }
        }
        bounds.push(data_end);
        let scans: Vec<step::ChunkScan> = bounds.par_windows(2).map(|w| step::scan_chunk(b, w[0], w[1])).collect();
        let mut consistent = true;
        for i in 0..scans.len().saturating_sub(1) {
            if scans[i].hit_endsec || scans[i].next_start != scans[i + 1].first_start {
                consistent = false;
                break;
            }
        }
        let scans = if consistent { scans } else { vec![step::scan_chunk(b, data_pos, data_end)] };
        let scan_ms = t0.elapsed().as_secs_f64() * 1000.0;
        progress(0.35, "Typen werden aufgelöst …");

        // intern type names per chunk, then merge
        let schema = schema_id.get();
        struct Local {
            names: Vec<Vec<u8>>,
            tys: Vec<u16>,
        }
        let locals: Vec<Local> = scans
            .par_iter()
            .map(|s| {
                let mut map: FxHashMap<&[u8], u16> = FxHashMap::default();
                let mut names: Vec<Vec<u8>> = Vec::new();
                let mut tys = Vec::with_capacity(s.recs.len());
                for r in &s.recs {
                    let name = &b[r.ty_start..r.ty_start + r.ty_len as usize];
                    let t = match map.get(name) {
                        Some(&t) => t,
                        None => {
                            let t = names.len() as u16;
                            names.push(name.to_vec());
                            map.insert(name, t);
                            t
                        }
                    };
                    tys.push(t);
                }
                Local { names, tys }
            })
            .collect();
        let mut types: Vec<TypeInfo> = Vec::new();
        let mut type_by_name: FxHashMap<String, u16> = FxHashMap::default();
        let remaps: Vec<Vec<u16>> = locals
            .iter()
            .map(|l| {
                l.names
                    .iter()
                    .map(|n| {
                        let upper = String::from_utf8_lossy(n).to_ascii_uppercase();
                        intern_type(&mut types, &mut type_by_name, schema, &upper)
                    })
                    .collect()
            })
            .collect();
        let total: usize = scans.iter().map(|s| s.recs.len()).sum();
        let mut recs: Vec<Rec> = Vec::with_capacity(total);
        for (ci, s) in scans.iter().enumerate() {
            let l = &locals[ci];
            let remap = &remaps[ci];
            recs.par_extend(s.recs.par_iter().zip(l.tys.par_iter()).map(|(r, &lt)| Rec::new(r.id, remap[lt as usize], r.args_start as u64, r.args_len, false)));
        }
        let mut diagnostics = Vec::new();
        for s in &scans {
            for (pos, msg) in s.errors.iter().take(1000) {
                let line = 1 + memchr::memchr_iter(b'\n', &b[..*pos]).count();
                diagnostics.push(Diagnostic { severity: Severity::Error, entity: None, message: format!("Zeile {line}: {msg}") });
            }
        }
        drop(locals);
        drop(scans);
        progress(0.5, "Index wird aufgebaut …");
        let t1 = std::time::Instant::now();

        // id map
        let max_id = recs.par_iter().map(|r| r.id).max().unwrap_or(0);
        let mut ids = if (max_id as usize) <= recs.len() * 4 + 1_000_000 {
            IdMap::Dense(vec![NO_IDX; max_id as usize + 1])
        } else {
            IdMap::Sparse(FxHashMap::default())
        };
        let mut dup = 0usize;
        for (i, r) in recs.iter().enumerate() {
            if ids.get(r.id) != NO_IDX {
                dup += 1;
                if dup <= 50 {
                    diagnostics.push(Diagnostic { severity: Severity::Error, entity: Some(r.id), message: format!("Doppelte Entity-Id #{}", r.id) });
                }
                continue;
            }
            ids.insert(r.id, i as u32);
        }
        if dup > 50 {
            diagnostics.push(Diagnostic { severity: Severity::Error, entity: None, message: format!("{dup} doppelte Entity-Ids insgesamt") });
        }

        // by type
        let mut by_type: Vec<Vec<u32>> = vec![Vec::new(); types.len()];
        for (i, r) in recs.iter().enumerate() {
            by_type[r.ty as usize].push(i as u32);
        }

        let src = Arc::new(bytes);
        let mut doc = Document {
            path: None,
            header,
            schema_id,
            src,
            arena: Vec::new(),
            recs,
            types,
            type_by_name,
            by_type,
            ids,
            inv: InverseIndex::default(),
            max_id,
            diagnostics,
            undo: Vec::new(),
            redo: Vec::new(),
            current: None,
            save_point: Some(0),
            revision: 0,
            load_stats: None,
            changed_ids: Vec::new(),
        };
        progress(0.7, "Referenzen werden indiziert …");
        let dangling = doc.build_inverse();
        if dangling > 0 {
            doc.diagnostics.push(Diagnostic { severity: Severity::Warning, entity: None, message: format!("{dangling} Referenzen zeigen auf nicht vorhandene Entities") });
        }
        let index_ms = t1.elapsed().as_secs_f64() * 1000.0;
        doc.load_stats = Some(LoadStats { bytes: doc.src.len(), entities: doc.recs.len(), scan_ms, index_ms, total_ms: t0.elapsed().as_secs_f64() * 1000.0 });
        progress(1.0, "Fertig");
        Ok(doc)
    }

    /// Create an empty document with the given schema.
    pub fn new_empty(schema_id: SchemaId) -> Document {
        let header = Header {
            description: vec!["ViewDefinition [ReferenceView]".into()],
            implementation_level: "2;1".into(),
            name: String::new(),
            time_stamp: now_iso(),
            author: vec![String::new()],
            organization: vec![String::new()],
            preprocessor: "IFCnative".into(),
            originating_system: "IFCnative".into(),
            authorization: String::new(),
            schema: vec![schema_id.header_label().into()],
        };
        Document {
            path: None,
            header,
            schema_id,
            src: Arc::new(Vec::new()),
            arena: Vec::new(),
            recs: Vec::new(),
            types: Vec::new(),
            type_by_name: FxHashMap::default(),
            by_type: Vec::new(),
            ids: IdMap::Dense(vec![NO_IDX]),
            inv: InverseIndex { offsets: vec![0], ..Default::default() },
            max_id: 0,
            diagnostics: Vec::new(),
            undo: Vec::new(),
            redo: Vec::new(),
            current: None,
            save_point: Some(0),
            revision: 0,
            load_stats: None,
            changed_ids: Vec::new(),
        }
    }

    fn build_inverse(&mut self) -> usize {
        let n = self.recs.len();
        let counts: Vec<AtomicU32> = (0..n).map(|_| AtomicU32::new(0)).collect();
        let dangling = AtomicU32::new(0);
        let recs = &self.recs;
        let ids = &self.ids;
        let src = &self.src[..];
        let arena = &self.arena[..];
        let text = |r: &Rec| -> &[u8] {
            let buf = if r.in_arena() { arena } else { src };
            &buf[r.off() as usize..r.off() as usize + r.len()]
        };
        recs.par_iter().for_each(|r| {
            if r.deleted() {
                return;
            }
            let mut local: smallvec::SmallVec<[u32; 16]> = smallvec::SmallVec::new();
            step::for_each_ref(text(r), |id| {
                let t = ids.get(id);
                if t == NO_IDX {
                    dangling.fetch_add(1, Ordering::Relaxed);
                } else if !local.contains(&t) {
                    local.push(t);
                }
            });
            for t in local {
                counts[t as usize].fetch_add(1, Ordering::Relaxed);
            }
        });
        let mut offsets = Vec::with_capacity(n + 1);
        let mut acc: u32 = 0;
        offsets.push(0);
        for c in &counts {
            acc += c.load(Ordering::Relaxed);
            offsets.push(acc);
        }
        let cursor: Vec<AtomicU32> = offsets[..n].iter().map(|&o| AtomicU32::new(o)).collect();
        let data: Vec<AtomicU32> = (0..acc as usize).map(|_| AtomicU32::new(0)).collect();
        recs.par_iter().enumerate().for_each(|(i, r)| {
            if r.deleted() {
                return;
            }
            let mut local: smallvec::SmallVec<[u32; 16]> = smallvec::SmallVec::new();
            step::for_each_ref(text(r), |id| {
                let t = ids.get(id);
                if t != NO_IDX && !local.contains(&t) {
                    local.push(t);
                }
            });
            for t in local {
                let p = cursor[t as usize].fetch_add(1, Ordering::Relaxed);
                data[p as usize].store(i as u32, Ordering::Relaxed);
            }
        });
        let mut data: Vec<u32> = data.into_iter().map(|a| a.into_inner()).collect();
        // deterministic order
        let chunks: Vec<(usize, usize)> = (0..n).map(|t| (offsets[t] as usize, offsets[t + 1] as usize)).filter(|(a, b)| b - a > 1).collect();
        {
            let ptr = SyncPtr(data.as_mut_ptr());
            chunks.par_iter().for_each(|&(a, b)| {
                let p = &ptr;
                // SAFETY: ranges are disjoint
                let s = unsafe { std::slice::from_raw_parts_mut(p.0.add(a), b - a) };
                s.sort_unstable();
            });
        }
        self.inv = InverseIndex { offsets, data, added: FxHashMap::default(), removed: FxHashSet::default() };
        dangling.into_inner() as usize
    }

    // ------------------------------------------------------------------ access

    pub fn schema(&self) -> &'static Schema {
        self.schema_id.get()
    }
    pub fn source_bytes(&self) -> &Arc<Vec<u8>> {
        &self.src
    }
    pub fn len(&self) -> usize {
        self.recs.len()
    }
    pub fn is_empty(&self) -> bool {
        self.recs.is_empty()
    }
    pub fn live_count(&self) -> usize {
        self.recs.iter().filter(|r| !r.deleted()).count()
    }
    pub fn max_id(&self) -> u32 {
        self.max_id
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn rec(&self, idx: u32) -> &Rec {
        &self.recs[idx as usize]
    }
    pub fn recs(&self) -> &[Rec] {
        &self.recs
    }
    #[inline]
    pub fn idx(&self, id: u32) -> Option<u32> {
        let i = self.ids.get(id);
        if i == NO_IDX || self.recs[i as usize].deleted() {
            None
        } else {
            Some(i)
        }
    }
    pub fn exists(&self, id: u32) -> bool {
        self.idx(id).is_some()
    }
    #[inline]
    pub fn text_of(&self, r: &Rec) -> &[u8] {
        let buf: &[u8] = if r.in_arena() { &self.arena } else { &self.src };
        &buf[r.off() as usize..r.off() as usize + r.len()]
    }
    /// Raw argument text of an entity.
    pub fn raw_args(&self, id: u32) -> Option<&[u8]> {
        self.idx(id).map(|i| self.text_of(&self.recs[i as usize]))
    }
    pub fn raw_args_str(&self, id: u32) -> Option<String> {
        self.raw_args(id).map(|b| String::from_utf8_lossy(b).into_owned())
    }
    pub fn args(&self, id: u32) -> Option<Vec<Value>> {
        self.raw_args(id).and_then(|b| parse_args(b).ok())
    }
    pub fn arg(&self, id: u32, n: usize) -> Option<Value> {
        self.args(id).and_then(|mut a| if n < a.len() { Some(a.swap_remove(n)) } else { None })
    }
    pub fn type_idx_of(&self, id: u32) -> Option<u16> {
        self.idx(id).map(|i| self.recs[i as usize].ty)
    }
    /// Upper case type keyword.
    pub fn type_name(&self, id: u32) -> Option<&str> {
        self.type_idx_of(id).map(|t| self.types[t as usize].name.as_str())
    }
    pub fn type_camel(&self, id: u32) -> Option<&str> {
        self.type_idx_of(id).map(|t| self.types[t as usize].camel.as_str())
    }
    pub fn type_flags(&self, id: u32) -> u32 {
        self.type_idx_of(id).map(|t| self.types[t as usize].flags).unwrap_or(0)
    }
    pub fn has_flag(&self, id: u32, f: u32) -> bool {
        self.type_flags(id) & f != 0
    }
    pub fn type_index(&self, upper: &str) -> Option<u16> {
        self.type_by_name.get(upper).copied()
    }
    pub fn is_a(&self, id: u32, parent_upper: &str) -> bool {
        match self.type_name(id) {
            Some(t) => self.schema().is_subtype_of(t, parent_upper),
            None => false,
        }
    }
    /// All live entity ids of exactly this type (upper case keyword).
    pub fn ids_of_type(&self, upper: &str) -> Vec<u32> {
        match self.type_index(upper) {
            Some(t) => self.ids_of_type_idx(t),
            None => vec![],
        }
    }
    pub fn ids_of_type_idx(&self, t: u16) -> Vec<u32> {
        self.by_type
            .get(t as usize)
            .map(|v| {
                let mut out: Vec<u32> = v.iter().map(|&i| &self.recs[i as usize]).filter(|r| !r.deleted() && r.ty == t).map(|r| r.id).collect();
                out.dedup();
                out
            })
            .unwrap_or_default()
    }
    /// All live ids whose type is `parent` or a subtype.
    pub fn ids_of_kind(&self, parent_upper: &str) -> Vec<u32> {
        let schema = self.schema();
        let mut out = Vec::new();
        for (t, info) in self.types.iter().enumerate() {
            if schema.is_subtype_of(&info.name, parent_upper) {
                out.extend(self.ids_of_type_idx(t as u16));
            }
        }
        out.sort_unstable();
        out
    }
    pub fn ids_with_flag(&self, f: u32) -> Vec<u32> {
        let mut out = Vec::new();
        for (t, info) in self.types.iter().enumerate() {
            if info.flags & f != 0 {
                out.extend(self.ids_of_type_idx(t as u16));
            }
        }
        out.sort_unstable();
        out
    }
    /// Counts of live entities per type index.
    pub fn type_counts(&self) -> Vec<(u16, usize)> {
        let mut counts = vec![0usize; self.types.len()];
        for r in &self.recs {
            if !r.deleted() {
                counts[r.ty as usize] += 1;
            }
        }
        counts.into_iter().enumerate().filter(|(_, c)| *c > 0).map(|(t, c)| (t as u16, c)).collect()
    }
    /// Entities referencing `id` (inverse references), as ids.
    pub fn referencing(&self, id: u32) -> Vec<u32> {
        let Some(i) = self.idx(id) else { return vec![] };
        let mut v: Vec<u32> = self.inv.get(i).into_iter().map(|s| &self.recs[s as usize]).filter(|r| !r.deleted()).map(|r| r.id).collect();
        v.sort_unstable();
        v.dedup();
        v
    }
    /// Referencing entities filtered by type flag.
    pub fn referencing_with_type(&self, id: u32, upper: &str) -> Vec<u32> {
        let t = self.type_index(upper);
        match t {
            None => vec![],
            Some(t) => self.referencing(id).into_iter().filter(|&r| self.type_idx_of(r) == Some(t)).collect(),
        }
    }
    /// Entities referenced by `id` (forward references).
    pub fn references(&self, id: u32) -> Vec<u32> {
        let mut out = Vec::new();
        if let Some(b) = self.raw_args(id) {
            step::for_each_ref(b, |r| {
                if !out.contains(&r) {
                    out.push(r)
                }
            });
        }
        out
    }
    /// Iterate all live entity ids in file order.
    pub fn all_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.recs.iter().filter(|r| !r.deleted()).map(|r| r.id)
    }
    pub fn attr_names(&self, id: u32) -> Vec<String> {
        match self.type_name(id) {
            Some(t) => self.schema().attr_names(t).into_iter().map(|s| s.to_string()).collect(),
            None => vec![],
        }
    }
    /// Argument by attribute name.
    pub fn attr(&self, id: u32, name: &str) -> Option<Value> {
        let t = self.type_name(id)?;
        let i = self.schema().attr_index(t, name)?;
        self.arg(id, i)
    }
    pub fn attr_str(&self, id: u32, name: &str) -> Option<String> {
        self.attr(id, name).and_then(|v| v.as_str().map(|s| s.to_string()))
    }
    pub fn name_of(&self, id: u32) -> Option<String> {
        if self.has_flag(id, tflags::ROOT) {
            return self.arg(id, 2).and_then(|v| v.as_str().map(|s| s.to_string()));
        }
        self.attr_str(id, "Name")
    }
    pub fn guid_of(&self, id: u32) -> Option<String> {
        if self.has_flag(id, tflags::ROOT) {
            self.arg(id, 0).and_then(|v| v.as_str().map(|s| s.to_string()))
        } else {
            None
        }
    }
    /// `#12=IFCWALL(...)` line text.
    pub fn step_line(&self, id: u32) -> Option<String> {
        let i = self.idx(id)?;
        let r = &self.recs[i as usize];
        Some(format!("#{}={}({});", r.id, self.types[r.ty as usize].name, String::from_utf8_lossy(self.text_of(r))))
    }

    // ------------------------------------------------------------------ edits

    fn intern(&mut self, upper: &str) -> u16 {
        let schema = self.schema_id.get();
        let before = self.types.len();
        let t = intern_type(&mut self.types, &mut self.type_by_name, schema, upper);
        if self.types.len() > before {
            self.by_type.push(Vec::new());
        }
        t
    }

    pub fn begin(&mut self, label: &str) {
        if self.current.is_none() {
            self.current = Some(Transaction { label: label.to_string(), changes: Vec::new(), time: std::time::SystemTime::now() });
        }
    }

    pub fn commit(&mut self) -> bool {
        let Some(tx) = self.current.take() else { return false };
        if tx.changes.is_empty() {
            return false;
        }
        if let Some(sp) = self.save_point {
            if sp > self.undo.len() {
                self.save_point = None;
            }
        }
        self.undo.push(tx);
        self.redo.clear();
        self.revision += 1;
        true
    }

    /// Abort the current transaction and revert its changes.
    pub fn rollback(&mut self) {
        if let Some(tx) = self.current.take() {
            for c in tx.changes.iter().rev() {
                self.apply_rec(c.idx, c.before);
            }
            self.revision += 1;
        }
    }

    pub fn in_transaction(&self) -> bool {
        self.current.is_some()
    }

    fn record_change(&mut self, idx: u32, before: Rec, after: Rec) {
        if before == after {
            return;
        }
        let auto = self.current.is_none();
        if auto {
            self.begin("Bearbeitung");
        }
        if let Some(tx) = self.current.as_mut() {
            // coalesce repeated edits of the same record inside one transaction
            if let Some(c) = tx.changes.iter_mut().rev().find(|c| c.idx == idx) {
                c.after = after;
            } else {
                tx.changes.push(Change { idx, before, after });
            }
        }
        self.apply_rec(idx, after);
        if auto {
            self.commit();
        }
    }

    fn rec_refs(&self, r: &Rec) -> Vec<u32> {
        if r.deleted() {
            return vec![];
        }
        let mut out: Vec<u32> = Vec::new();
        step::for_each_ref(self.text_of(r), |id| {
            let t = self.ids.get(id);
            if t != NO_IDX && !out.contains(&t) {
                out.push(t);
            }
        });
        out
    }

    fn apply_rec(&mut self, idx: u32, new: Rec) {
        let old = self.recs[idx as usize];
        let old_refs = self.rec_refs(&old);
        let new_refs = self.rec_refs(&new);
        self.inv.apply_diff(idx, &old_refs, &new_refs);
        if old.ty != new.ty {
            self.by_type[new.ty as usize].push(idx);
        }
        self.recs[idx as usize] = new;
        self.changed_ids.push(new.id);
        self.revision += 1;
    }

    fn arena_push(&mut self, text: &str) -> (u64, u32) {
        let off = self.arena.len() as u64;
        self.arena.extend_from_slice(text.as_bytes());
        (off, text.len() as u32)
    }

    /// Replace the argument list of an entity.
    pub fn set_args(&mut self, id: u32, args: &[Value]) -> anyhow::Result<()> {
        let text = step::args_to_step(args);
        self.set_raw(id, None, &text)
    }

    /// Replace type and/or raw argument text (validated).
    pub fn set_raw(&mut self, id: u32, new_type: Option<&str>, args_text: &str) -> anyhow::Result<()> {
        let idx = self.idx(id).ok_or_else(|| anyhow::anyhow!("Entity #{id} existiert nicht"))?;
        parse_args(args_text.as_bytes()).map_err(|e| anyhow::anyhow!("Ungültige Argumente: {e}"))?;
        let before = self.recs[idx as usize];
        let ty = match new_type {
            Some(t) => self.intern(&t.trim().to_ascii_uppercase()),
            None => before.ty,
        };
        if new_type.is_none() && self.text_of(&before) == args_text.as_bytes() {
            return Ok(());
        }
        let (off, len) = self.arena_push(args_text);
        let after = Rec::new(id, ty, off, len, true);
        self.record_change(idx, before, after);
        Ok(())
    }

    /// Set a single positional argument.
    pub fn set_arg(&mut self, id: u32, n: usize, v: Value) -> anyhow::Result<()> {
        let mut args = self.args(id).ok_or_else(|| anyhow::anyhow!("Entity #{id} nicht lesbar"))?;
        while args.len() <= n {
            args.push(Value::Null);
        }
        args[n] = v;
        self.set_args(id, &args)
    }

    pub fn set_attr(&mut self, id: u32, attr: &str, v: Value) -> anyhow::Result<()> {
        let t = self.type_name(id).ok_or_else(|| anyhow::anyhow!("Entity #{id} existiert nicht"))?.to_string();
        let i = self.schema().attr_index(&t, attr).ok_or_else(|| anyhow::anyhow!("{t} hat kein Attribut {attr}"))?;
        self.set_arg(id, i, v)
    }

    pub fn next_id(&self) -> u32 {
        self.max_id + 1
    }

    /// Create a new entity; returns its id.
    pub fn create(&mut self, type_upper: &str, args: &[Value]) -> u32 {
        let text = step::args_to_step(args);
        self.create_raw(type_upper, &text).expect("valid args")
    }

    pub fn create_raw(&mut self, type_upper: &str, args_text: &str) -> anyhow::Result<u32> {
        parse_args(args_text.as_bytes()).map_err(|e| anyhow::anyhow!("Ungültige Argumente: {e}"))?;
        let ty = self.intern(&type_upper.trim().to_ascii_uppercase());
        let id = self.max_id + 1;
        self.max_id = id;
        let (off, len) = self.arena_push(args_text);
        let live = Rec::new(id, ty, off, len, true);
        let idx = self.recs.len() as u32;
        self.recs.push(live.with_deleted(true));
        self.ids.insert(id, idx);
        self.by_type[ty as usize].push(idx);
        self.inv.offsets.push(*self.inv.offsets.last().unwrap_or(&0));
        let before = self.recs[idx as usize];
        self.record_change(idx, before, live);
        Ok(id)
    }

    /// Delete an entity (references to it are left untouched; see ops::delete_entities).
    pub fn delete(&mut self, id: u32) -> bool {
        let Some(idx) = self.idx(id) else { return false };
        let before = self.recs[idx as usize];
        self.record_change(idx, before, before.with_deleted(true));
        true
    }

    // ------------------------------------------------------------------ history

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
    pub fn undo_label(&self) -> Option<&str> {
        self.undo.last().map(|t| t.label.as_str())
    }
    pub fn redo_label(&self) -> Option<&str> {
        self.redo.last().map(|t| t.label.as_str())
    }
    pub fn history(&self) -> &[Transaction] {
        &self.undo
    }
    pub fn redo_stack(&self) -> &[Transaction] {
        &self.redo
    }

    pub fn undo(&mut self) -> Option<Vec<u32>> {
        self.commit();
        let tx = self.undo.pop()?;
        for c in tx.changes.iter().rev() {
            self.apply_rec(c.idx, c.before);
        }
        let touched = tx.touched_ids(self);
        self.redo.push(tx);
        self.revision += 1;
        Some(touched)
    }

    pub fn redo(&mut self) -> Option<Vec<u32>> {
        let tx = self.redo.pop()?;
        for c in tx.changes.iter() {
            self.apply_rec(c.idx, c.after);
        }
        let touched = tx.touched_ids(self);
        self.undo.push(tx);
        self.revision += 1;
        Some(touched)
    }

    pub fn is_dirty(&self) -> bool {
        self.save_point != Some(self.undo.len()) || self.current.as_ref().map(|t| !t.changes.is_empty()).unwrap_or(false)
    }
    pub fn mark_saved(&mut self) {
        self.save_point = Some(self.undo.len());
    }

    /// Drain ids changed since the last call (for incremental viewer updates).
    pub fn take_changed_ids(&mut self) -> Vec<u32> {
        let mut v = std::mem::take(&mut self.changed_ids);
        v.sort_unstable();
        v.dedup();
        v
    }

    // ------------------------------------------------------------------ saving

    pub fn header_text(&self) -> String {
        let h = &self.header;
        let list = |v: &Vec<String>| -> String {
            let parts: Vec<String> = v.iter().map(|s| format!("'{}'", step::encode_string(s))).collect();
            format!("({})", parts.join(","))
        };
        let schema = if h.schema.is_empty() { vec![self.schema_id.header_label().to_string()] } else { h.schema.clone() };
        format!(
            "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION({},'{}');\nFILE_NAME('{}','{}',{},{},'{}','{}','{}');\nFILE_SCHEMA({});\nENDSEC;\n",
            list(&if h.description.is_empty() { vec!["ViewDefinition [ReferenceView]".to_string()] } else { h.description.clone() }),
            step::encode_string(if h.implementation_level.is_empty() { "2;1" } else { &h.implementation_level }),
            step::encode_string(&h.name),
            step::encode_string(&h.time_stamp),
            list(&h.author),
            list(&h.organization),
            step::encode_string(&h.preprocessor),
            step::encode_string(&h.originating_system),
            step::encode_string(&h.authorization),
            list(&schema),
        )
    }

    /// Serialise to STEP bytes (parallel).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.src.len() + self.arena.len() + 4096);
        out.extend_from_slice(self.header_text().as_bytes());
        out.extend_from_slice(b"DATA;\n");
        let parts: Vec<Vec<u8>> = self
            .recs
            .par_chunks(65536)
            .map(|chunk| {
                let mut buf = Vec::with_capacity(chunk.len() * 80);
                let mut itoa = itoa_buf();
                for r in chunk {
                    if r.deleted() {
                        continue;
                    }
                    buf.push(b'#');
                    buf.extend_from_slice(fmt_u32(&mut itoa, r.id));
                    buf.push(b'=');
                    buf.extend_from_slice(self.types[r.ty as usize].name.as_bytes());
                    buf.push(b'(');
                    buf.extend_from_slice(self.text_of(r));
                    buf.extend_from_slice(b");\n");
                }
                buf
            })
            .collect();
        for p in parts {
            out.extend_from_slice(&p);
        }
        out.extend_from_slice(b"ENDSEC;\nEND-ISO-10303-21;\n");
        out
    }

    pub fn save_as(&mut self, path: &Path) -> anyhow::Result<()> {
        self.commit();
        self.header.time_stamp = now_iso();
        if self.header.preprocessor.is_empty() {
            self.header.preprocessor = "IFCnative".into();
        }
        if let Some(n) = path.file_name() {
            self.header.name = n.to_string_lossy().into_owned();
        }
        let bytes = self.to_bytes();
        let tmp = path.with_extension("ifcnative-tmp");
        if path.extension().map(|e| e.eq_ignore_ascii_case("ifczip")).unwrap_or(false) {
            let inner = path.with_extension("ifc");
            let name = inner.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "model.ifc".into());
            let zipped = crate::io::zip_ifc(&name, &bytes)?;
            std::fs::write(&tmp, zipped)?;
        } else {
            std::fs::write(&tmp, &bytes)?;
        }
        std::fs::rename(&tmp, path)?;
        self.path = Some(path.to_path_buf());
        self.mark_saved();
        Ok(())
    }

    /// Rebuild indexes and compact storage (drops undo history).
    pub fn compact(&mut self) -> anyhow::Result<()> {
        let bytes = self.to_bytes();
        let path = self.path.clone();
        let mut d = Document::from_bytes(bytes, &|_, _| {})?;
        d.path = path;
        d.save_point = None;
        *self = d;
        Ok(())
    }
}

struct SyncPtr(*mut u32);
unsafe impl Sync for SyncPtr {}
unsafe impl Send for SyncPtr {}

fn itoa_buf() -> [u8; 12] {
    [0u8; 12]
}
fn fmt_u32(buf: &mut [u8; 12], mut v: u32) -> &[u8] {
    let mut i = buf.len();
    if v == 0 {
        i -= 1;
        buf[i] = b'0';
    }
    while v > 0 {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
    }
    &buf[i..]
}

fn intern_type(types: &mut Vec<TypeInfo>, by_name: &mut FxHashMap<String, u16>, schema: &Schema, upper: &str) -> u16 {
    if let Some(&t) = by_name.get(upper) {
        return t;
    }
    let t = types.len() as u16;
    let schema_idx = schema.index_of(upper);
    let camel = schema_idx.map(|i| schema.entities[i].name.clone()).unwrap_or_else(|| upper.to_string());
    let is = |p: &str| schema.is_subtype_of(upper, p);
    let mut flags = 0;
    if is("IFCROOT") {
        flags |= tflags::ROOT;
    }
    if is("IFCPRODUCT") {
        flags |= tflags::PRODUCT;
    }
    if is("IFCELEMENT") {
        flags |= tflags::ELEMENT;
    }
    if is("IFCSPATIALELEMENT") || is("IFCSPATIALSTRUCTUREELEMENT") {
        flags |= tflags::SPATIAL;
    }
    if is("IFCRELATIONSHIP") {
        flags |= tflags::REL;
    }
    if is("IFCPROPERTYSET") {
        flags |= tflags::PSET;
    }
    if is("IFCELEMENTQUANTITY") {
        flags |= tflags::QSET;
    }
    if is("IFCTYPEOBJECT") {
        flags |= tflags::TYPE_OBJECT;
    }
    if is("IFCOPENINGELEMENT") || is("IFCFEATUREELEMENTSUBTRACTION") {
        flags |= tflags::OPENING;
    }
    if is("IFCPROPERTY") {
        flags |= tflags::PROPERTY;
    }
    if is("IFCPHYSICALQUANTITY") {
        flags |= tflags::QUANTITY;
    }
    if is("IFCGROUP") {
        flags |= tflags::GROUP;
    }
    if is("IFCMATERIALDEFINITION") || is("IFCMATERIAL") || is("IFCMATERIALLAYERSET") || is("IFCMATERIALLAYERSETUSAGE") || is("IFCMATERIALLIST") {
        flags |= tflags::MATERIAL;
    }
    if is("IFCREPRESENTATIONITEM") {
        flags |= tflags::REPR_ITEM;
    }
    if is("IFCPROJECT") || is("IFCCONTEXT") {
        flags |= tflags::PROJECT;
    }
    if is("IFCANNOTATION") || is("IFCGRID") {
        flags |= tflags::ANNOTATION;
    }
    if is("IFCFEATUREELEMENT") {
        flags |= tflags::FEATURE;
    }
    types.push(TypeInfo { name: upper.to_string(), camel, schema_idx, flags });
    by_name.insert(upper.to_string(), t);
    t
}

fn find_data_section(b: &[u8]) -> Option<usize> {
    // "DATA;" at line start after header (skip strings in header)
    let mut pos = 0;
    while let Some(off) = memchr::memmem::find(&b[pos..], b"DATA") {
        let p = pos + off;
        let prev_ok = p == 0 || matches!(b[p - 1], b'\n' | b'\r' | b';' | b' ' | b'\t');
        let mut q = p + 4;
        while q < b.len() && (b[q] == b' ' || b[q] == b'\t' || b[q] == b'\r' || b[q] == b'\n') {
            q += 1;
        }
        if prev_ok && q < b.len() && (b[q] == b';' || b[q] == b'(') {
            // DATA; or DATA('...') -> skip to ';'
            let semi = memchr::memchr(b';', &b[q..]).map(|o| q + o + 1)?;
            return Some(semi);
        }
        pos = p + 4;
    }
    None
}

fn parse_header(b: &[u8]) -> Header {
    let mut h = Header::default();
    let scan = step::scan_chunk_header(b);
    for (name, args) in scan {
        let vals = parse_args(args).unwrap_or_default();
        let strs = |v: Option<&Value>| -> Vec<String> {
            match v {
                Some(Value::List(l)) => l.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect(),
                Some(Value::Str(s)) => vec![s.clone()],
                _ => vec![],
            }
        };
        let s = |v: Option<&Value>| v.and_then(|x| x.as_str()).unwrap_or_default().to_string();
        match name.as_str() {
            "FILE_DESCRIPTION" => {
                h.description = strs(vals.first());
                h.implementation_level = s(vals.get(1));
            }
            "FILE_NAME" => {
                h.name = s(vals.first());
                h.time_stamp = s(vals.get(1));
                h.author = strs(vals.get(2));
                h.organization = strs(vals.get(3));
                h.preprocessor = s(vals.get(4));
                h.originating_system = s(vals.get(5));
                h.authorization = s(vals.get(6));
            }
            "FILE_SCHEMA" => {
                h.schema = strs(vals.first());
            }
            _ => {}
        }
    }
    h
}

pub fn now_iso() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}
