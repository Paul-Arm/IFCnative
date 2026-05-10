# IFCnative v2 work plan

Branch: `v2`

Owner request: iterate overnight on meaningful improvements until model limits become the blocker.

Priorities from Paul:

1. Expand graph view.
2. Add edit / move workflows in the 3D viewer.
3. Add simple bodies and assign them to IFC entities.
4. Add a diff/review workflow: describe changes first, let user inspect, then write/export IFC.

Completed:

- Added an IFC Diff / Review pane.
- Builder, inspector, and graph mutations now stage a draft document instead of immediately replacing the active IFC.
- Export is disabled while a draft is pending; user can Apply or Discard after inspecting the diff.
- Verified with `npm run test:ifc` and `npm run build`.

Suggested next iterations:

- Improve 3D viewer editing: transform controls for selected object, with draft move operation instead of immediate write.
- Add simple body creation presets with dimensions and placement fields, ideally using rectangular swept solids.
- Make graph expansion/filtering stronger: relationship-type filters, neighborhood search, pinned layouts persisted in document/session.
- Improve diff preview from single-hunk prefix/suffix into entity-aware diffs grouped by STEP id.
- Add tests for staged draft behavior and new builder helpers.

Rules for follow-up agents:

- Work in `/Users/paul/.openclaw/workspace/repos/IFCnative` on branch `v2`.
- Keep commits small and descriptive.
- Run `npm run test:ifc` and `npm run build` before each commit when practical.
- Do not push unless Paul explicitly asks or GitHub auth is made available.
- Avoid destructive git operations. If dirty state exists, inspect and continue carefully.
