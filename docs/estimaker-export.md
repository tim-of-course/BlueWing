# EstiMaker quantity contract

The existing Quantities view and `quantities.exportEstiMaker` share the pure TypeScript projection in `src/core/quantity-presentation.ts`, using the current project and calculation snapshot. The projection reads the stock orders, installed cuts and surface purchases from that snapshot.

Choose **Export to EstiMaker** to save/download JSON. CLI calls require a destination:

```sh
bluewing quantities.exportEstiMaker '{"payload":{"path":"/absolute/path/estimate.estimaker.json"}}'
```

The command returns `{path,text}`: text exactly matches the file; path is null on UI cancellation. It adds no revision, Undo step, review gate or native command.

## Version 2

Checked examples: [sized pieces](../tests/fixtures/estimaker-takeoff-v2.json) and [counts/missing dimensions](../tests/fixtures/estimaker-counts-and-missing-v2.json). `TakeoffEnvelope` and `TakeoffRow` define the contract. `QuantityIssue` is internal to Bluewing.

The envelope contains kind `bluewing.takeoff`, version 2, project `{id,name,revision}` (revision string), takeoff `{id,name,kind}`, ISO exportedAt, informational calculationComplete and coverage, and rows. There is no exported skipped list or consumer unresolved state.

Each row contains:

- Stable lineId, unsuffixed baseDescription, and import-ready description.
- Numeric quantity and unit `LF | SF | count`.
- Existing recipe category, empty when absent; no new scope tags.
- Source `{groupId,groupLabel,assignmentId,recipeId,outputId,materialId}`. Optional source identities may be null. Modeled outputId is null because legacy members/N and surface/N are positional; formula output IDs remain component-qualified.
- Optional purchased pieceCount, unit-tagged pieceLength, and cutSchedule `[{count,length}]` describing installed cuts before waste/packages.
- Provenance `{basis:"purchased",originalAmount,originalUnit,physicalLengthSource?,sourceRefs,modelingStatus}`. Original amount is null when required quantity is unavailable. References contain nullable geometry/sheet/piece/surface IDs. Packed orders also carry `packedCount`, `wastePercent`, `wasteAmount` (sticks before rounding) and package count and size (where specified) in provenance. Their references identify the source group, assignment and recipe for each cut. A shared order carries any single-owner identities common to all its cuts.

## Descriptions and numbers

EstiMaker imports supplied descriptions and numeric quantities. It does not judge guesses, calculation completeness, model coverage or fractional footage, and does not infer rows from diagnostics. Its normal numeric rounding applies. No extra preview, approval or unresolved-item workflow is required.

- Purchased lengths are reported in LF and areas in SF.
- Sized pieces use purchased count times explicit valid stock length, or valid cut length when no stock exists. Example: `Tee - 2ft (75pc)`, quantity 150 LF. Structured count/length remain available.
- Intentional count-only material is a normal row: `Door Frames (count)`, quantity 75, unit count.
- Known material lacking required physical input/calibration or piece dimension is prepared by Bluewing as `5/8 Gyp (missing quantity)`, actual quantity **0**, unit SF. EstiMaker does not infer that zero or maintain an unresolved state.

For example, track cuts of 6, 6, 4, 4 and 3 ft fit three 10 ft sticks. At 5% waste the order rounds from 3.15 to four sticks. EstiMaker receives one 40 LF row with `pieceCount` 4 and a five-cut schedule.

The projection preserves engine waste/package rounding exactly once, keeps mixed-cut/common-stock buckets intact, and never rounds counts again. Fractional purchased numbers remain numeric. Required cut schedules are ordering detail, not additional imported footage. Description text never supplies dimensions.

SF is ordinary square footage. Scalar is dimensionless, not SF; no scalar-to-area mapping is guessed. Unresolvable assemblies/sources, broken formulas, invalid supplied stock, nonfinite quantities, missing semantic identity and duplicate line IDs are producer errors. Bluewing fails before saving rather than omitting items or fabricating consumer placeholders.

## Identity and integration

Line IDs are versioned, URI-encoded semantic engine bucket keys, independent of quantities, project and assembly display names, revisions, timestamps, array positions and changing source sets. Formula keys use assignment, component-qualified output and cut/stock bucket. Modeled stock order keys use scope category, material ID, stock length, direction, waste percent and package size across the selected takeoff. A different scope category or material ID creates a separate line, including estimator-defined breakouts. Stock orders keep the same ID when assignments or source pieces change within the bucket. Surfaces and pieces ordered by cut length retain their assignment-level identities.

The consumer may group material parents by genuine material ID and unit, keep length children by lineId, and intentionally update them through the existing CSV import/update/Bulk Update interaction. It need not strip description suffixes. No prices, narrative, screenshots or handoff-document content enter the file.

This version exports one selected takeoff and applies its contribution directions after positive purchasing and conversion.

Version 2 exports the CLI current takeoff (Main initially, changed with `takeoff.select`) or the one-request envelope `takeoffId` override, independently of UI selection, and adds `takeoff: {id,name,kind}`. Each row retains `direction` and positive `grossQuantity`; `quantity` applies the sign only after the existing purchasing/conversion. Counts, missing-quantity zero rows, fractional purchases, ordering and producer failures retain the producer semantics above. No skipped list is exported. Line IDs use `bwq2:<takeoffId>:` followed by the encoded purchase key, so takeoff renaming never changes identity. Default filenames include the takeoff ID. See [named takeoffs](named-takeoffs.md) for scoping and handoff context.
