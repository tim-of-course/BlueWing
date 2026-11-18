# EstiMaker quantity contract

The Quantities view and `quantities.exportEstiMaker` use the same purchasing projection in `src/core/quantity-presentation.ts`. Choose **Export to EstiMaker** to save JSON. CLI calls take a destination and return `path`, `rowCount` and `missingQuantityRowCount`.

```sh
bluewing quantities.exportEstiMaker '{"payload":{"path":"/absolute/path/estimate.estimaker.json"}}'
```

## Version 3

The envelope contains `kind: "bluewing.takeoff"`, version 3, project ID, name and string revision, takeoff ID, name and kind, ISO export time, calculation and model coverage, and rows. The CLI current takeoff starts on Main. Use `takeoff.select` or supply a request-level `takeoffId`.

**Import each order as one material parent keyed by `orderId`.** Each exported row is a child. Upsert children by `lineId`, display `subItem.label`, and sum the signed child `quantity` values exactly once. Preserve fractional sub-items until the parent total is computed. Reimporting a takeoff replaces children removed from that takeoff's order. Version 3 changes line identity and row meaning from version 2.

- `orderQuantity` is the positive purchased amount in the row's `unit` (LF, SF or count). The order description, count, size, cut schedule and total repeat on each child. Use one copy as parent metadata.
- Group children have `subItem.kind: "group"`, a group ID and the current group name. Their `grossQuantity` is the unrounded requirement including the group's waste. For stock sticks it is installed cut footage. `quantity` applies the takeoff direction, so deductions have a negative sign.
- Whole-unit purchases also have a `rounding` child, including when its amount is zero. Its label is **Offcuts, waste and rounding** for stock sticks and **Rounding** for other whole goods. Continuous LF, SF and unpackaged plain counts have only group children.
- `packageQuantity` is the child's unsigned quantity in packages when present. For example, groups requiring 292.3, 82.4 and 12.7 sheets contribute 387.4 sheets. The rounding line contributes 0.6 and the parent orders 388 sheets. The additive import quantities remain SF.
- `pieceCount` carries the order's purchased piece or package count. Dimensioned pieces also carry a unit-tagged `pieceLength` and installed `cutSchedule`. Sheet sizes and hang direction appear in the description. Package count and size are in provenance.
- Source references retain the contributing group, assignment, recipe, geometry, sheet, piece or surface, and formula output ID when applicable. A field shared by several owners can be null. The rounding child has no drawing references.
- `provenance.originalAmount` and `originalUnit` describe the order before conversion to import units. Known materials lacking a required physical quantity export a named zero group row with a null original amount. Invalid formulas, stock, scalar quantities and unresolved assemblies remain producer errors.
- Modeled wall finishes and cavity insulation carry gross area, layered opening area and opening waste as a percentage of gross. Bluewing uses the project’s standard sizes and applies package rounding after pooling.

Orders separate material IDs, scope categories, units, stock or cut lengths, sheet sizes and hang directions, batt products, add/deduct direction, waste and package sizes. An intentionally different scope or material ID creates a distinct parent. Line IDs begin with `bwq3:`; the encoded identity includes the takeoff, purchase key, child kind and group ID where applicable. Treat these IDs as opaque. Renaming a group preserves its child's identity.

The checked fixtures show sized pieces and the count/missing-dimension contract. [Sized pieces](../tests/fixtures/estimaker-takeoff-v3.json) · [Counts and missing dimensions](../tests/fixtures/estimaker-counts-and-missing-v3.json)
