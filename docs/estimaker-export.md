# EstiMaker quantity contract

The existing Quantities view and `quantities.exportEstiMaker` share the pure TypeScript projection in `src/core/quantity-presentation.ts`, using the current project and calculation snapshot. Existing purchasing math and generic CSV/JSON exports remain unchanged.

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
- Provenance `{basis:"purchased",originalAmount,originalUnit,physicalLengthSource?,sourceRefs,modelingStatus}`. Original amount is null when required quantity is unavailable. References contain nullable geometry/sheet/piece/surface IDs.

## Descriptions and numbers

EstiMaker imports supplied descriptions and numeric quantities. It does not judge guesses, calculation completeness, model coverage or fractional footage, and does not infer rows from diagnostics. Its normal numeric rounding applies. No extra preview, approval or unresolved-item workflow is required.

- Purchased lengths convert to LF and areas to SF: 1 ft = 0.3048 m, 1 SF = 0.09290304 square metres.
- Sized pieces use purchased count times explicit valid stock length, or valid cut length when no stock exists. Example: `Tee - 2ft (75pc)`, quantity 150 LF. Structured count/length remain available.
- Intentional count-only material is a normal row: `Door Frames (count)`, quantity 75, unit count.
- Known material lacking required physical input/calibration or piece dimension is prepared by Bluewing as `5/8 Gyp (missing quantity)`, actual quantity **0**, unit SF. EstiMaker does not infer that zero or maintain an unresolved state.

The projection preserves engine waste/package rounding exactly once, keeps mixed-cut/common-stock buckets intact, and never rounds counts again. Fractional purchased numbers remain numeric. Required cut schedules are ordering detail, not additional imported footage. Description text never supplies dimensions.

SF is ordinary square footage. Scalar is dimensionless, not SF; no scalar-to-area mapping is guessed. Unresolvable assemblies/sources, broken formulas, invalid supplied stock, nonfinite quantities, missing semantic identity and duplicate line IDs are producer errors. Bluewing fails before saving rather than omitting items or fabricating consumer placeholders.

## Identity and integration

Line IDs are versioned, URI-encoded semantic engine bucket keys, independent of quantities, names, revisions, timestamps, array positions and changing source sets. Formula keys use assignment, component-qualified output and cut/stock bucket. Modeled keys retain existing material, owner, finish, physical-length, waste and package distinctions.

The consumer may group material parents by genuine material ID and unit, keep length children by lineId, and intentionally update them through the existing CSV import/update/Bulk Update interaction. It need not strip description suffixes. No prices, narrative, screenshots or handoff-document content enter the file.

This version exports one explicitly selected takeoff and applies its contribution directions after positive purchasing and conversion.

Version 2 exports exactly the explicit request-envelope `takeoffId`, independently of UI selection, and adds `takeoff: {id,name,kind}`. Each row retains `direction` and positive `grossQuantity`; `quantity` applies the sign only after the existing purchasing/conversion. Counts, missing-quantity zero rows, fractional purchases, ordering and producer failures retain the producer semantics above. No skipped list is exported. Line IDs use `bwq2:<takeoffId>:` followed by the encoded purchase key, so takeoff renaming never changes identity. Default filenames include the takeoff ID. See [named takeoffs](named-takeoffs.md) for scoping and handoff context.
