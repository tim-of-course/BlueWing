import type { Assembly, CeilingTemplate, WallTemplate } from './types';
import type { HeaderComponent, MemberSpec } from './construction-types';
import type { MaterialTemplate } from './material-layout';

const ft = 0.3048;
const inch = 0.0254;
const sheet = 32 * ft ** 2;

const member = (
  materialId: string,
  width: number,
  depth: number,
  stockFeet: number,
): MemberSpec => ({
  materialId,
  width: width * inch,
  depth: depth * inch,
  stockLength: stockFeet * ft,
});
const component = (
  id: string,
  role: string,
  spec: MemberSpec,
  verticalOffset = 0,
  faceOffset = 0,
): HeaderComponent => ({
  id,
  role,
  member: spec,
  startExtension: 0,
  endExtension: 0,
  verticalOffset: verticalOffset * inch,
  faceOffset: faceOffset * inch,
});
const layout = (
  id: string,
  name: string,
  category: string,
  description: string,
  materialTemplate: MaterialTemplate,
): Assembly => ({
  id,
  name,
  category,
  description,
  geometryKinds: [materialTemplate.kind === 'area-members' ? 'area' : 'path'],
  inputs: [],
  outputs: [],
  materialTemplate,
});

function surface(
  id: string,
  name: string,
  category: string,
  materialId: string,
  thickness: number,
  description: string,
  height?: number,
): Assembly {
  return layout(
    id,
    name,
    category,
    `Modeled standalone finish with no framing. Trace each face or panel along its actual width and direction; enter its height and base elevation. Located openings remove the same patches from 3D and installed area. Layers multiply area and thickness. ${description} Thickness and products are editable starter values. Sheet purchasing is coverage only, without board seams or cutting optimization.`,
    {
      kind: 'path-surface',
      elevation: 0,
      materialId,
      layers: 1,
      thickness: thickness * inch,
      ...(height === undefined ? {} : { height: height * inch }),
      ...(category === 'Acoustical wall panels' ? {} : { packageSize: sheet }),
      openings: [],
    },
  );
}

function horizontal(
  id: string,
  name: string,
  category: string,
  materialId: string,
  thickness: number,
  elevation: number,
  description: string,
): Assembly {
  const ceilingTemplate: CeilingTemplate = {
    elevation: elevation * ft,
    materialId,
    layers: 1,
    thickness: thickness * inch,
    packageSize: sheet,
  };
  return {
    id,
    name,
    category,
    description: `Modeled horizontal finish following the traced area, with no framing or grid. ${description} Elevation is the lower face; thickness extends upward. Set the specified product, layers, thickness and package coverage. Quantities measure the displayed surface, with waste and whole-sheet purchasing applied afterward.`,
    geometryKinds: ['area'],
    inputs: [],
    outputs: [],
    ceilingTemplate,
  };
}

/** Practical material layouts, not engineered connection or structural specifications. */
export function modeledStarters(wall: WallTemplate): Assembly[] {
  const stud = member('steel-stud-6in-unspecified', 1.625, 6, 12);
  const headerTrack = member(
    'steel-header-track-3-5-8-unspecified',
    3.625,
    1.25,
    10,
  );
  const framing = structuredClone(wall);
  framing.finishes = [];
  return [
    {
      id: 'steel-framing',
      name: 'Steel framing wall',
      category: 'Light gauge framing',
      description:
        'Modeled 3-5/8 in framing wall without finishes. Enter height, specified sections, stud spacing, stock lengths and end allowances. Openings, project header details and backing rows produce actual members. Starter dimensions are editable examples, not a structural specification.',
      geometryKinds: ['path'],
      inputs: [],
      outputs: [],
      wallTemplate: framing,
    },
    layout(
      'steel-track-run',
      'Steel track run',
      'Light gauge framing',
      'Modeled track along each traced segment at its entered centreline elevation. Starter section is 3-5/8 by 1-1/4 in with 10 ft stock. Trace actual joints or separate lengths; long members are flagged rather than silently spliced. No stud or fastener quantities are added.',
      {
        kind: 'path-members',
        elevation: 0,
        components: [
          component(
            'track',
            'track',
            member('steel-track-3-5-8-unspecified', 3.625, 1.25, 10),
          ),
        ],
      },
    ),
    layout(
      'steel-box-header',
      'Steel box header',
      'Light gauge framing',
      'Modeled example with two 6 in stud sections and top/bottom track in a 3-5/8 in wide envelope. Starter bottom elevation is 7 ft, with zero end extensions. Enter the actual detail: section sizes, orientation, offsets, stock and bearing extensions. This is not a load-rated header design. For a wall opening, copy its components into a project Header detail and assign that detail to the opening; do not also apply a separate header trace for that same material.',
      {
        kind: 'path-members',
        elevation: 7 * ft,
        components: [
          component('left-stud', 'header-stud', stud, 3, -1),
          component('right-stud', 'header-stud', structuredClone(stud), 3, 1),
          component('bottom-track', 'header-track', headerTrack, 0.625),
          component(
            'top-track',
            'header-track',
            structuredClone(headerTrack),
            5.375,
          ),
        ],
      },
    ),
    layout(
      'steel-joists',
      'Steel joist layout',
      'Light gauge framing',
      'Modeled parallel joists clipped to the traced area, including separate spans at concave boundaries. Starter centrelines are 9 ft high at 16 in spacing, parallel to world X with origin 0,0; sections are 6 by 1-5/8 in with 20 ft stock. Set actual direction, origin, spacing, elevation and specified sections. Border/rim members, bridging, bearing extensions and connections must be entered separately. Members are not silently spliced.',
      {
        kind: 'area-members',
        elevation: 9 * ft,
        spacing: 16 * inch,
        origin: { x: 0, y: 0 },
        rotation: 0,
        role: 'joist',
        member: member('steel-joist-6in-unspecified', 1.625, 6, 20),
      },
    ),
    layout(
      'steel-kick',
      'Steel kick brace',
      'Light gauge framing',
      'Modeled diagonal brace following a traced plan path. Starter centreline elevations rise from 9 ft to 12 ft; enter the actual attachment elevations and horizontal run. Cut length is the true 3D distance plus entered end extensions. Starter section is 3-5/8 by 1-5/8 in with 10 ft stock. Each path segment is a separate piece; connections and fastening are separate scope.',
      {
        kind: 'path-members',
        elevation: 9 * ft,
        endElevation: 12 * ft,
        components: [
          component(
            'kick',
            'kick',
            member('steel-kick-3-5-8-unspecified', 1.625, 3.625, 10),
          ),
        ],
      },
    ),
    layout(
      'steel-furring',
      'Ceiling furring layout',
      'Light gauge framing',
      'Modeled parallel furring clipped to a traced ceiling area. Starter centrelines are 9 ft high at 24 in spacing, parallel to world X with origin 0,0; envelopes are 2-5/8 in wide by 7/8 in deep with 12 ft stock. Replace these example dimensions, spacing and orientation with the specified system. Carrier channels, hangers and connections are separate scope. Trace joints where required; no automatic splicing.',
      {
        kind: 'area-members',
        elevation: 9 * ft,
        spacing: 24 * inch,
        origin: { x: 0, y: 0 },
        rotation: 0,
        role: 'furring',
        member: member('steel-furring-unspecified', 2.625, 0.875, 12),
      },
    ),
    layout(
      'wood-blocking',
      'Wood blocking pieces',
      'Blocking and rough carpentry',
      'Modeled blocks measured from individual path segments. Trace the actual ends of each block and enter its centreline elevation. Starter 2x6 uses actual 1-1/2 by 5-1/2 in dimensions and 8 ft stock. Set the specified size, orientation and product. No inferred between-stud cuts, fasteners or offcut reuse.',
      {
        kind: 'path-members',
        elevation: 4 * ft,
        components: [
          component(
            'block',
            'blocking',
            member('wood-blocking-2x6-unspecified', 1.5, 5.5, 8),
          ),
        ],
      },
    ),
    surface(
      'plywood-backing',
      'Plywood backing strip',
      'Blocking and rough carpentry',
      'plywood-backing-3-4-unspecified',
      0.75,
      'Starts with an 8 in high strip of 3/4 in plywood and editable 4x8 sheet coverage. Set its mounting elevation and actual strip width; trace separate rows separately.',
      8,
    ),
    surface(
      'frp-wall',
      'FRP wall finish',
      'FRP',
      'frp-unspecified',
      0.09,
      'Starts with 0.090 in FRP and editable 4x8 sheet coverage. Adhesive and trim are separate scope.',
    ),
    surface(
      'acoustical-wall-surface',
      'Acoustical wall panel layout',
      'Acoustical wall panels',
      'acoustical-wall-panel-unspecified',
      1,
      'Starts with 1 in thick panels. Trace each panel for visible gaps, or trace continuous treatment for coverage. Installed quantities are area; enter the selected panel coverage for package purchasing. Mounting hardware is separate scope.',
    ),
    surface(
      'drywall-wall-surface',
      'Drywall wall finish',
      'Drywall',
      'drywall-5-8-unspecified',
      0.625,
      'Starts with 5/8 in board and editable 4x8 sheet coverage. Use separate assignments for different board products.',
    ),
    horizontal(
      'drywall-ceiling',
      'Drywall ceiling finish',
      'Drywall',
      'drywall-5-8-unspecified',
      0.625,
      9,
      'Starts with 5/8 in board, 4x8 sheet coverage and a 9 ft underside.',
    ),
    surface(
      'plywood-wall-surface',
      'Plywood wall sheathing',
      'Other sheathing',
      'plywood-3-4-unspecified',
      0.75,
      'Starts with 3/4 in plywood and editable 4x8 sheet coverage. Enter the specified grade, thickness and treatment.',
    ),
    surface(
      'gypsum-sheathing-wall',
      'Gypsum wall sheathing',
      'Other sheathing',
      'gypsum-sheathing-5-8-unspecified',
      0.625,
      'Starts with 5/8 in gypsum sheathing and editable 4x8 sheet coverage. Enter the specified sheathing product and thickness.',
    ),
    surface(
      'cement-board-wall',
      'Cement board wall finish',
      'Other sheathing',
      'cement-board-1-2-unspecified',
      0.5,
      'Starts with 1/2 in cement board. Change package coverage to the selected board size; the editable starter is 4x8.',
    ),
    horizontal(
      'plywood-deck',
      'Plywood horizontal sheathing',
      'Other sheathing',
      'plywood-3-4-unspecified',
      0.75,
      0,
      'Starts with 3/4 in plywood, 4x8 sheet coverage and a 0 ft underside; enter the actual elevation.',
    ),
    horizontal(
      'acoustical-ceiling-tile',
      'Acoustical ceiling tile area',
      'Acoustical ceilings',
      'ceiling-tile-unspecified',
      0.625,
      9,
      'For tile-only work. Starts with 5/8 in tile thickness and a 9 ft underside. Package coverage defaults to 32 sq ft; set the chosen carton coverage. Use the 2x2 or 2x4 ceiling layout when the grid is also in scope.',
    ),
  ];
}
