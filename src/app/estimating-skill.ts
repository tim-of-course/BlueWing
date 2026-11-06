// Company estimating skill served to CLI/Wingman agents by `estimating.skill`.
// Plain text instructions only; Bluewing does not enforce or track them.
export const estimatingSkill = `# Bluewing estimating skill

Follow this skill for any takeoff or estimating work in Bluewing. It holds our company standards so you do not need to ask for them. Ask the user only where this skill says to.

## Our scopes

Each scope is listed with its exact assembly category name in quotes.

- Light gauge metal framing: "Light-gauge metal framing".
- Wood blocking, including structural blocking and equipment backing: "Wood blocking/backing". If the job is wood framed, exclude all wood work; it is left to the framers. Check the structural sheets, general notes and wall types to decide.
- Sheathing and FRP, including Zip board and FRP-like panels such as Marlite: "Sheathing/FRP".
- Moisture barriers, such as liquid applied barriers and Tyvek: "Moisture barriers".
- Drywall hanging and finishing: "Drywall hang/finish".
- Acoustical ceilings and other acoustical work: "Acoustical ceilings/acoustical work".
- Insulation: "Insulation". Include all insulation inside walls we frame, mainly fiberglass and rockwool. We sometimes insulate wood framed walls too. Include it there when the scope package includes insulation (such as drywall and insulation) or the user or documents indicate we do it, and ask if unclear. On commercial jobs, roof insulation usually belongs to the roofers, so exclude it and note the exclusion. Include spray foam only in small quantities to fill gaps. If the insulation is mostly spray foam, exclude it.
- Demo occasionally: "Demo". Never include demo unless the user asks for it.

## Scope package

The job is usually one of these:
1. Drywall only.
2. Ceilings only.
3. Drywall and ceilings.
4. Drywall and insulation, especially on residential jobs.
5. All of the scopes above (except demo).

Other combinations are rare. Infer the package from the user's request and the documents. Ask the user only if it is unclear.

## Before takeoff

- Read the project notes (notes.read, or notes.search for a topic). Earlier agents and people record job facts there, so use them instead of rediscovering them.
- Check the takeoffs with takeoff.list. Work in Main unless the user names a phase or change order. If they do, switch to it with takeoff.select before working. The selection lasts until you change it and does not move the user's view. Check the takeoff named in each result.
- In a change order, enter removed work as deductions and new work as additions. For changed work, copy the original from Main as a deduction (takeoff.copyItems) and draw the replacement as an addition.
- If the sheets are not already named from the plan page labels, run the AI Page Naming workflow (sheet.naming.start) without asking.

## Project notes

Record job facts in the project notes as you find them, with the sheet and detail where each was found. Include:
- the scope package and framing type
- ceiling and deck heights
- wall heights for each wall type, part by part (framing, kicks, drywall, sheathing, FRP, insulation)
- insulation types and who does roof insulation
- FRP type, acoustical ceiling type and drywall finish level
- assumptions and RFI questions

Read the notes before writing, and keep other people's text. Notes are plain Markdown shared with everyone on the project.

## During takeoff

- Give every assembly the exact category name for its scope (see Our scopes). Bluewing colors the plan and 3D views by category, so do not set colors yourself. Use a custom category only for work outside our standard scopes.
- Use a separate assembly for each scope, even when scopes share the same line or area. For example, framing and drywall on one wall are two assemblies. This lets each scope be filtered and colored on its own.
- Take off footage (LF or SF) for every item. Where it is reasonable or the documents are specific, also get item counts and sizes, for example how many studs of each size.
- When the documents leave a quantity uncertain, carry the larger quantity and flag it as an assumption. Never leave the item out and never use the smaller quantity. Example: 10 ft ceilings and 12 ft deck with no indication of how far up the drywall goes: carry drywall to deck and flag it.
- Before finishing, ask the user when the larger quantity is massively larger. Example: 10 ft ceilings under a 20 ft deck. Raise any other significant blocking factor with the user while you work, too. Do not leave these only for the handoff document.
- Use 10% waste by default. Use a different waste only when there is a special reason, and record that reason in the handoff document's assumptions. EstiMaker adds no waste of its own, so the waste set in Bluewing is final.
- Every item must have a quantity. An item missing a dimension, calibration or piece size (it shows as "(missing quantity)" in the EstiMaker export) is a blocking item. Fix it, or list it under Items needing a decision. The handoff document stays Draft while any remain.

## 3D visualization

Include 3D visualization by default; it is a key review metric. Use construction.render for the views in the handoff document.

- A single-page view needs no alignment.
- For a combined view of several pages (for example the floor plan and the reflected ceiling plan), first check whether the pages line up. If they do not, align them with construction.alignment.match, using the same grid line intersections or columns on each page. Report the residual error. Alignment only moves the combined 3D view; it never changes quantities or single-page views.
- For focused views of one scope, filter by category (the categories option of construction.render).

## Handoff document

Write a handoff document whenever you did a meaningful amount of the takeoff yourself. It is a standalone HTML file that you write; Bluewing does not generate it. Write one handoff document per takeoff. Save it as one .html file named <project>-<takeoffId>-handoff.html in projectFolder, which estimating.skill returns alongside this text (the folder holding the Bluewing project file). If projectFolder is null, ask the user where to save it. Tell the user its path.

### Draft status

Put this exact element in the document head:

<script type="application/json" id="bluewing-handoff">{"draft": true}</script>

- Use {"draft": true} while you are still working or are waiting on blocking items.
- Change it to {"draft": false} when you have finished and are satisfied the takeoff and document are ready for human review.
- Complete ({"draft": false}) means only that you finished and are satisfied it is ready for human review. It does not mean a human approved it or that quantities are verified. Never describe it that way. Do not track whether a human has reviewed it.
- Also show the status as visible text near the top of the document, "Status: Draft" or "Status: Complete", so it reads correctly in any browser. Keep the visible text and the JSON in agreement.
- The Bluewing viewer only reads this flag to show Draft or Complete. It does not store or link the document to the project.

### Contents

Use these sections in this order. Leave out a section only when it would be empty, except Review questions, which is always included.

1. Summary: job name, takeoff name (Main, phase or change order), plan set and date, scope package, scopes covered, scopes excluded and why (for example wood framed job, demo not requested).
2. Items needing a decision: significant blocking factors you raised with the user, their answers or that they are still open, and what is currently carried.
3. Scopes and quantities: footage per scope, with item counts and sizes where you took them off.
4. Review questions: answer each of these. Say where each answer was found (sheet and detail) and include a screenshot of the note or tag (snippet.render or sheet.render). Write "Unspecified" when the documents do not say, and list where you looked.
   - Ceiling heights.
   - Deck heights.
   - Wall heights: every part of every wall type needs a verified height. That means the framing and each layer on it, such as drywall, sheathing, plywood and FRP. Parts of one wall often stop at different heights. Examples: framing to 10 ft with kick braces to deck; framing and plywood to deck with drywall only partway up. For each wall type, say how high each part goes, where that was found, and which heights are not stated. Wall types often give all of this at once, but not always. When they don't, check sections, details and notes before calling a height unknown.
   - Framing: wood or metal, and what that means for our wood scope.
   - FRP type, if relevant.
   - Acoustical ceiling type, if relevant.
   - Insulation, if relevant: type and where it goes, whether roof insulation is by others, and whether any spray foam is gap-fill only.
   - Drywall finish level, if relevant.
5. Assumptions: numbered, each with the reason and the quantity impact if it is wrong.
6. Notes and warnings.
7. RFI questions for the GC: always include them, numbered and written ready to send.
8. 3D views: a combined view plus focused views as useful, each with a caption.
9. Sheets reviewed: the sheet names used.

### Look and layout

- It should look and read like a Word document or a PDF, even though it is HTML. No cards, chips, badges, pills, colored panels or dashboard styling.
- One centered page column (about 8.5 in wide) on a white background, black text, plain headings, simple tables with thin rules.
- A contents list at the top with links that scroll to each section, and a small "Back to contents" link after each section.
- Use plain expandable sections (details/summary) for screenshots and long tables, such as each review question's screenshot and detailed quantity tables. Keep answers themselves visible without expanding.
- Write statuses as plain words, for example "Specified", "Assumed" or "Unspecified".
- Make it fully standalone: inline the CSS and embed images as data URIs. No external fonts, scripts or links that are needed to read it.
- Expand all expandable sections when printing.
- Keep the structure the same from job to job so reviewers know where to look.

## EstiMaker export

As the last step, after finishing the handoff document, export the takeoff quantities with quantities.exportEstiMaker. Save the file in projectFolder, named <project>-<takeoffId>.estimaker.json. Tell the user its path.
`;

/** Folder containing a project file path, for Windows or POSIX separators. */
export function projectFolder(path: string): string {
  const end = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return end > 0 ? path.slice(0, end) : end === 0 ? path.slice(0, 1) : '.';
}
