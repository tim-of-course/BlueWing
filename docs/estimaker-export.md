# EstiMaker quantity contract

The existing Quantities view and `quantities.exportEstiMaker` use the pure TypeScript projection in `src/core/quantity-presentation.ts`. It consumes the current `Project` and shared `CalculationSnapshot`; it neither calculates a second estimate nor changes project state. Generic quantity CSV/JSON and piece exports remain available.

Choose **Export to EstiMaker** in Quantities. Desktop opens the existing native save dialog; browser mode downloads JSON. The CLI requires an explicit destination:

```sh
bluewing quantities.exportEstiMaker '{"payload":{"path":"/absolute/path/estimate.estimaker.json"}}'
```

The command returns `{path,text}`: `text` is exactly the saved JSON; `path` is null when a UI save dialog is canceled. No project revision, undo step, review gate, or Rust command is added. The existing native `write_file` capability writes the file. CLI help and `commands.list` expose the application registry entry.

## Version 1

The checked example is [estimaker-takeoff-v1.json](../tests/fixtures/estimaker-takeoff-v1.json), generated from [quantity-project.ts](../tests/fixtures/quantity-project.ts) and compared in core tests. The exported TypeScript `TakeoffEnvelope`, `TakeoffRow`, and `SkippedQuantity` interfaces define the contract.

| Field                 | Meaning                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `kind`, `version`     | `bluewing.takeoff`, `1`                                                                                            |
| `project`             | Current `{id,name,revision}`; revision is a string                                                                 |
| `exportedAt`          | ISO timestamp                                                                                                      |
| `calculationComplete` | Calculation validity, independent of 3D coverage                                                                   |
| `coverage`            | `modeledOutputs`, `estimateOutputs`, `unresolvedOutputs`, `complete`                                               |
| `rows`                | Eligible purchased LF/SF lines                                                                                     |
| `skipped`             | Source identity, nullable semantic line ID, source references, code, corrective reason and calculation diagnostics |

A row contains `lineId`, `baseDescription` (the existing unsuffixed material/output description), `description` (including piece size/count where relevant), `quantity`, `unit` (`LF` or `SF`), existing recipe `category` (empty if absent), and `source: {groupId,groupLabel,assignmentId,recipeId,outputId,materialId}`. Missing genuine identities are null. Modeled `outputId` is null because the legacy `members/N` and `surface/N` IDs are positional rather than authored IDs. Formula output IDs include the component-qualified ID for systems. Component categories come from the existing component assembly category, falling back to the owning recipe.

Piece rows also carry purchased `pieceCount`, physical `pieceLength: {value,unit}` (`m`, `mm`, `ft`, `in`), and available `cutSchedule: [{count,length}]`. The cut schedule describes required installed pieces before waste/packages; it is ordering detail, not another quantity to add to the row. Mixed required cuts sharing stock remain one purchase row. Counts and stock lengths follow the engine's one stock per purchased piece assumption; no cut optimization or offcut reuse is inferred.

Every row has `provenance: {basis:'purchased',originalAmount,originalUnit,physicalLengthSource?,sourceRefs,modelingStatus}`. References contain nullable `geometryId`, `sheetId`, `pieceId`, and `surfaceId`; labels are read from the current project. `physicalLengthSource` is `stock` or `cut` for pieces. No prices, scope fields, narrative, screenshots, review notes, or review answers enter this file.

Skipped items also retain `baseDescription`, `description`, existing `category`, and `provenance: {basis:'purchased',originalAmount,originalUnit,modelingStatus}`. Known raw purchased amounts/units are provenance only. Nonfinite or unavailable amounts are null; unresolved placeholder amounts/units are null. Skipped items contain no valid footage quantity. The consumer can use `baseDescription` without stripping suffix text, group genuine material IDs with LF/SF, and keep source line IDs on length buckets. Stable identity supports intentional reimport updates; it does not prescribe duplicate skipping or an extra preview/approval step. Import/update interactions belong to EstiMaker.

## Purchasing and diagnostics

Length purchases convert to LF and area purchases to SF (1 ft = 0.3048 m, 1 SF = 0.09290304 m²). Piece purchases multiply the existing purchased piece count by valid explicit stock length, or by valid explicit cut length when stock is missing/null. Supplied nonpositive/nonfinite stock is invalid and cannot fall back to cut. A valid 75-piece purchase at 2 ft therefore exports **150 LF** and a 75-piece ordering detail. Descriptions never supply units or dimensions.

The projection never rounds counts, reapplies waste/packages, splits purchase totals, or changes net/adjusted/purchased engine math. Fractional purchased piece counts are skipped with `invalid-quantity` and a package-size correction message. Incomplete and unresolved outputs are skipped, as are unsupported scalar/count-only outputs, absent physical lengths, invalid stock, nonfinite quantities and missing semantic identities. Their diagnostic codes are explicit in `skipped`; calculation errors never become silent zero lines. Valid formula estimates export even when model coverage is incomplete. Valid unsupported native quantities remain readable in Bluewing alongside their export warning.

## Identity and future takeoff ownership

`lineId` is a versioned, URI-encoded semantic `quantityKey`, carried from the actual calculation/purchase bucket. Existing public output IDs are preserved. Formula keys use assignment, component-qualified output and the engine's cut/stock bucket. Modeled member keys use assignment/wall/ceiling, material, stock-or-cut, waste and package. Surface keys use assignment/wall/ceiling, finish, material, waste and package. Rename, reorder, quantity changes, timestamps, revisions and changing drawing source sets are not identity inputs. A bucket-defining cut/stock or allowance change can create a different modeled line.

This version exports the current project. There is no persisted takeoff ID, selection placeholder, change-order direction or inferred scope. Future takeoff ownership and additions/deductions must pass an explicitly selected calculation into this projection, extend the contract deliberately, apply purchasing before sign, and retain gross additions/deductions as well as net. EstiMaker import behavior and that ownership infrastructure are separate work.
