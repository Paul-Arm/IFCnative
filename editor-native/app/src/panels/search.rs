//! Filter / query builder over classes, attributes and properties.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use ifc_doc::{model, tflags, Document};
use rayon::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Field {
    #[default]
    Property,
    Attribute,
    Material,
    Classification,
    Storey,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Op {
    #[default]
    Equals,
    NotEquals,
    Contains,
    Exists,
    Missing,
    Greater,
    Less,
    Regex,
}

#[derive(Clone, Debug, Default)]
pub struct Cond {
    pub field: Field,
    pub pset: String,
    pub name: String,
    pub op: Op,
    pub value: String,
}

#[derive(Default)]
pub struct SearchState {
    pub class: String,
    pub subtypes: bool,
    pub conds: Vec<Cond>,
    pub results: Vec<u32>,
    pub ran: bool,
    pub millis: f64,
}

fn check(doc: &Document, tree: &model::SpatialTree, id: u32, c: &Cond) -> bool {
    let vals: Vec<String> = match c.field {
        Field::Attribute => doc.attr(id, &c.name).map(|v| vec![v.display()]).unwrap_or_default(),
        Field::Property => model::psets_of(doc, id)
            .into_iter()
            .filter(|p| c.pset.trim().is_empty() || p.name.eq_ignore_ascii_case(c.pset.trim()))
            .flat_map(|p| p.props)
            .filter(|p| p.name.eq_ignore_ascii_case(c.name.trim()))
            .map(|p| p.value.display())
            .collect(),
        Field::Material => model::materials_of(doc, id).into_iter().flat_map(|m| m.layers.into_iter().map(|l| l.material_name)).collect(),
        Field::Classification => model::classifications_of(doc, id).into_iter().map(|c| format!("{} {}", c.identification, c.name)).collect(),
        Field::Storey => tree.storey_of(doc, id).map(|s| vec![model::label(doc, s)]).unwrap_or_default(),
    };
    let v = c.value.trim();
    match c.op {
        Op::Exists => !vals.is_empty() && vals.iter().any(|x| !x.is_empty()),
        Op::Missing => vals.is_empty() || vals.iter().all(|x| x.is_empty()),
        Op::Equals => vals.iter().any(|x| x.eq_ignore_ascii_case(v)),
        Op::NotEquals => !vals.iter().any(|x| x.eq_ignore_ascii_case(v)),
        Op::Contains => vals.iter().any(|x| x.to_lowercase().contains(&v.to_lowercase())),
        Op::Greater | Op::Less => {
            let Ok(t) = v.replace(',', ".").parse::<f64>() else { return false };
            vals.iter().filter_map(|x| x.replace(',', ".").parse::<f64>().ok()).any(|x| if c.op == Op::Greater { x > t } else { x < t })
        }
        Op::Regex => match regex::Regex::new(v) {
            Ok(re) => vals.iter().any(|x| re.is_match(x)),
            Err(_) => false,
        },
    }
}

pub fn run(doc: &Document, tree: &model::SpatialTree, st: &SearchState) -> Vec<u32> {
    let class = st.class.trim().to_ascii_uppercase();
    let class = if class.is_empty() || class.starts_with("IFC") { class } else { format!("IFC{class}") };
    let candidates: Vec<u32> = if class.is_empty() {
        doc.ids_with_flag(tflags::PRODUCT)
    } else if st.subtypes {
        doc.ids_of_kind(&class)
    } else {
        doc.ids_of_type(&class)
    };
    candidates.into_par_iter().filter(|&id| st.conds.iter().all(|c| check(doc, tree, id, c))).collect()
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.search;
    ui.horizontal(|ui| {
        ui.label("Klasse");
        ui.add(egui::TextEdit::singleline(&mut st.class).hint_text("z. B. IfcWall (leer = alle Produkte)").desired_width(170.0));
        ui.checkbox(&mut st.subtypes, "inkl. Untertypen");
    });
    let mut remove = None;
    for (i, c) in st.conds.iter_mut().enumerate() {
        ui.horizontal(|ui| {
            egui::ComboBox::from_id_salt(("field", i)).selected_text(match c.field {
                Field::Property => "Eigenschaft",
                Field::Attribute => "Attribut",
                Field::Material => "Material",
                Field::Classification => "Klassifikation",
                Field::Storey => "Geschoss",
            })
            .width(95.0)
            .show_ui(ui, |ui| {
                ui.selectable_value(&mut c.field, Field::Property, "Eigenschaft");
                ui.selectable_value(&mut c.field, Field::Attribute, "Attribut");
                ui.selectable_value(&mut c.field, Field::Material, "Material");
                ui.selectable_value(&mut c.field, Field::Classification, "Klassifikation");
                ui.selectable_value(&mut c.field, Field::Storey, "Geschoss");
            });
            if c.field == Field::Property {
                ui.add(egui::TextEdit::singleline(&mut c.pset).hint_text("Pset (optional)").desired_width(100.0));
            }
            if matches!(c.field, Field::Property | Field::Attribute) {
                ui.add(egui::TextEdit::singleline(&mut c.name).hint_text("Name").desired_width(90.0));
            }
            egui::ComboBox::from_id_salt(("op", i)).selected_text(match c.op {
                Op::Equals => "=",
                Op::NotEquals => "≠",
                Op::Contains => "enthält",
                Op::Exists => "vorhanden",
                Op::Missing => "fehlt",
                Op::Greater => ">",
                Op::Less => "<",
                Op::Regex => "RegEx",
            })
            .width(70.0)
            .show_ui(ui, |ui| {
                for (o, n) in [(Op::Equals, "="), (Op::NotEquals, "≠"), (Op::Contains, "enthält"), (Op::Exists, "vorhanden"), (Op::Missing, "fehlt"), (Op::Greater, ">"), (Op::Less, "<"), (Op::Regex, "RegEx")] {
                    ui.selectable_value(&mut c.op, o, n);
                }
            });
            if !matches!(c.op, Op::Exists | Op::Missing) {
                ui.add(egui::TextEdit::singleline(&mut c.value).hint_text("Wert").desired_width(90.0));
            }
            if ui.small_button(ic::CLOSE).clicked() {
                remove = Some(i);
            }
        });
    }
    if let Some(i) = remove {
        st.conds.remove(i);
    }
    ui.horizontal(|ui| {
        if ui.button(format!("{} Bedingung", ic::PLUS)).clicked() {
            st.conds.push(Cond::default());
        }
        if ui.button(format!("{} Suchen", ic::SEARCH)).clicked() {
            let t = std::time::Instant::now();
            st.results = run(&s.doc, &s.tree, st);
            st.millis = t.elapsed().as_secs_f64() * 1000.0;
            st.ran = true;
        }
    });
    if !st.ran {
        return;
    }
    ui.separator();
    ui.horizontal(|ui| {
        ui.label(format!("{} Treffer ({:.0} ms)", st.results.len(), st.millis));
        if ui.small_button(format!("{} Auswählen", ic::SELECT)).clicked() {
            let r = st.results.clone();
            s.select(r, false);
        }
        if ui.small_button(format!("{} Isolieren", ic::ISOLATE)).clicked() {
            let r = st.results.clone();
            s.isolate(&r);
        }
        if ui.small_button(format!("{} Ausblenden", ic::HIDE)).clicked() {
            let r = st.results.clone();
            s.hide(&r);
        }
    });
    let row_h = 18.0;
    let results = st.results.clone();
    egui::ScrollArea::vertical().auto_shrink([false, false]).show_rows(ui, row_h, results.len(), |ui, range| {
        for i in range {
            let id = results[i];
            let sel = s.selection.contains(&id);
            if ui.selectable_label(sel, format!("{} {}  #{}", ic::for_class(s.doc.type_name(id).unwrap_or("")), model::label(&s.doc, id), id)).clicked() {
                s.select(vec![id], ui.input(|i| i.modifiers.ctrl));
            }
        }
    });
}
