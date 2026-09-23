//! Icon glyphs (Phosphor icon font).

pub use egui_phosphor::regular as ph;

pub const CURSOR: &str = ph::CURSOR;
pub const BOX_SELECT: &str = ph::SELECTION;
pub const RULER: &str = ph::RULER;
pub const SECTION: &str = ph::SCISSORS;
pub const SECTION_LIST: &str = ph::SQUARE_HALF;
pub const FIT: &str = ph::CORNERS_OUT;
pub const FOCUS: &str = ph::CROSSHAIR;
pub const CUBE: &str = ph::CUBE;
pub const ORTHO: &str = ph::PERSPECTIVE;
pub const XRAY: &str = ph::CUBE_TRANSPARENT;
pub const ISOLATE: &str = ph::CUBE_FOCUS;
pub const HIDE: &str = ph::EYE_SLASH;
pub const SHOW: &str = ph::EYE;
pub const PALETTE: &str = ph::PALETTE;
pub const DELETE: &str = ph::TRASH;
pub const CAMERA: &str = ph::CAMERA;
pub const CLEAR: &str = ph::BROOM;
pub const SELECT: &str = ph::SELECTION_ALL;
pub const TREE: &str = ph::TREE_STRUCTURE;
pub const LIST: &str = ph::LIST_BULLETS;
pub const SEARCH: &str = ph::MAGNIFYING_GLASS;
pub const WARN: &str = ph::WARNING;
pub const HISTORY: &str = ph::CLOCK_COUNTER_CLOCKWISE;
pub const UNDO: &str = ph::ARROW_COUNTER_CLOCKWISE;
pub const REDO: &str = ph::ARROW_CLOCKWISE;
pub const SAVE: &str = ph::FLOPPY_DISK;
pub const OPEN: &str = ph::FOLDER_OPEN;
pub const NEW: &str = ph::FILE_PLUS;
pub const CLOSE: &str = ph::X;
pub const SETTINGS: &str = ph::GEAR;
pub const GRAPH: &str = ph::GRAPH;
pub const TAG: &str = ph::TAG;
pub const CHECK: &str = ph::CHECK_CIRCLE;
pub const FILTER: &str = ph::FUNNEL;
pub const PLUS: &str = ph::PLUS;
pub const MINUS: &str = ph::MINUS;
pub const COPY: &str = ph::COPY;
pub const INFO: &str = ph::INFO;
pub const MOVE: &str = ph::ARROWS_OUT_CARDINAL;
pub const CARET_RIGHT: &str = ph::CARET_RIGHT;
pub const CARET_DOWN: &str = ph::CARET_DOWN;
pub const LINK: &str = ph::LINK;
pub const TABLE: &str = ph::TABLE;
pub const CHART: &str = ph::CHART_BAR;
pub const BUILD: &str = ph::WALL;
pub const EXPORT: &str = ph::EXPORT;
pub const CODE: &str = ph::CODE;
pub const EDIT: &str = ph::PENCIL_SIMPLE;
pub const LAYERS: &str = ph::STACK;
pub const GROUP: &str = ph::SQUARES_FOUR;
pub const DIFF: &str = ph::CHECKS;

/// Icon for an IFC class keyword (upper case).
pub fn for_class(t: &str) -> &'static str {
    let t = t.trim_start_matches("IFC");
    match t {
        "PROJECT" | "PROJECTLIBRARY" => ph::BRIEFCASE,
        "SITE" => ph::MAP_TRIFOLD,
        "BUILDING" => ph::BUILDINGS,
        "BUILDINGSTOREY" => ph::STACK,
        "SPACE" => ph::SQUARE_SPLIT_HORIZONTAL,
        "FACILITY" | "BRIDGE" | "ROAD" | "RAILWAY" | "MARINEFACILITY" => ph::BRIDGE,
        _ if t.starts_with("WALL") || t.starts_with("CURTAINWALL") => ph::WALL,
        _ if t.starts_with("SLAB") || t.starts_with("PLATE") || t.starts_with("COVERING") => ph::SQUARE_LOGO,
        _ if t.starts_with("ROOF") => ph::HOUSE_LINE,
        _ if t.starts_with("DOOR") => ph::DOOR,
        _ if t.starts_with("WINDOW") => ph::FRAME_CORNERS,
        _ if t.starts_with("COLUMN") || t.starts_with("PILE") => ph::COLUMNS,
        _ if t.starts_with("BEAM") || t.starts_with("MEMBER") => ph::RECTANGLE,
        _ if t.starts_with("STAIR") || t.starts_with("RAMP") => ph::STAIRS,
        _ if t.starts_with("RAILING") => ph::DOTS_THREE_OUTLINE,
        _ if t.starts_with("FURNI") => ph::ARMCHAIR,
        _ if t.starts_with("OPENING") => ph::SELECTION_SLASH,
        _ if t.starts_with("REL") => ph::LINK,
        _ if t.starts_with("PROPERTY") || t.starts_with("ELEMENTQUANTITY") => ph::TAG,
        _ if t.starts_with("MATERIAL") => ph::STACK_SIMPLE,
        _ if t.starts_with("GROUP") || t.starts_with("SYSTEM") || t.starts_with("ZONE") || t.starts_with("DISTRIBUTIONSYSTEM") => ph::SQUARES_FOUR,
        _ if t.contains("PIPE") || t.contains("DUCT") || t.starts_with("FLOW") => ph::PIPE,
        _ if t.contains("ELECTRIC") || t.contains("CABLE") || t.contains("LIGHT") => ph::LIGHTNING,
        _ if t.starts_with("ANNOTATION") || t.starts_with("GRID") => ph::GRID_FOUR,
        _ if t.starts_with("ALIGNMENT") => ph::PATH,
        _ if t.ends_with("TYPE") || t.ends_with("STYLE") => ph::SHAPES,
        _ => ph::CUBE,
    }
}
