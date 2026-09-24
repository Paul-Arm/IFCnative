//! UI panels.

pub mod batch;
pub mod builder;
pub mod clash;
pub mod classes;
pub mod diagnostics;
pub mod diff;
pub mod graph;
pub mod groups;
pub mod history;
pub mod ids;
pub mod import;
pub mod inspector;
pub mod inspector_ext;
pub mod materials;
pub mod misc;
pub mod quantities;
pub mod script;
pub mod search;
pub mod spaces;
pub mod stats;
pub mod table;
pub mod tree;
pub mod viewer;

/// Per-panel UI state that lives across frames.
#[derive(Default)]
pub struct PanelState {
    pub tree: tree::TreeState,
    pub search: search::SearchState,
    pub diag: diagnostics::DiagState,
    pub batch: batch::BatchState,
    pub builder: builder::BuilderState,
    pub clash: clash::ClashState,
    pub ids: ids::IdsState,
    pub import: import::ImportState,
    pub ids_path: Option<std::path::PathBuf>,
    pub diff: diff::DiffState,
    pub groups: groups::GroupsState,
    pub graph: graph::GraphState,
    pub table: table::TableState,
    pub spaces: spaces::SpacesState,
    pub materials: materials::MaterialsState,
    pub pending_select: Option<Vec<u32>>,
    pub dragging: Option<u32>,
    pub drop_target: Option<(u32, u32)>,
    pub delete_purge: bool,
    pub builder_pick: Option<glam::DVec3>,
    pub tree_new: Option<(u32, String, String)>,
    pub structure_dialog: bool,
    pub class_cache: ((u64, u64, u64), Vec<(String, usize, String)>),
    pub stats_cache: Option<((u64, u64), Vec<(String, (usize, usize, f64, f64))>)>,
}
