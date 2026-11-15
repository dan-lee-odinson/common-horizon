// The figures from the brief for this lane, written down once, for the check script only.
//
// This is deliberately a separate copy from the numbers inside the model scripts. The check
// compares three things that must agree: this brief, each model's JSON file, and the shape
// measured from its .glb. If someone changes a model script and its JSON together by mistake,
// the comparison with the brief still catches it.

export const TRIANGLE_LIMIT = 20000; // "Under 20,000 triangles each"
export const SIZE_TOLERANCE = 0.01; // "fails if a size is more than 1 percent off its JSON"
// Origin rule ("origin at the centre of the footprint on the ground"): our own tolerance, 1 mm.
export const ORIGIN_TOLERANCE_M = 0.001;
// Exact note for each kind of model (the project plan): code-built models are drawn by a script
// here; imported ones come from a community CAD model; generated ones are made from a photo by
// TRELLIS.2. Imported and generated models are finished by finish-model.mjs.
export const REQUIRED_NOTES = Object.freeze({
  'code-built': 'illustrative shape, built with SI/AI-written code',
  imported: "illustrative shape from a community CAD model; not the manufacturer's data",
  generated: "illustrative shape, SI/AI-generated from a photo; not the manufacturer's data",
});
export const KINDS = Object.freeze(Object.keys(REQUIRED_NOTES));
export const REQUIRED_NOTE = REQUIRED_NOTES['code-built'];
// The only 3D generator allowed for generated models, and the only image cleanup model.
export const GENERATOR_MODEL = 'TRELLIS.2';
export const CLEANUP_MODEL = 'Nano Banana 2';

export const STATUS_LABELS = Object.freeze({
  nasaSecondary: 'NASA figure, secondary source',
  nasaStudy: 'NASA study',
  nasaGoal: 'NASA goal',
  ourEstimate: 'our estimate, to be replaced by a published figure',
  companySecondary: 'company figure, secondary source',
  nasaFigure: 'NASA figure',
  companyFigure: "company figure (maker's own page)",
  jaxaFigure: 'JAXA figure',
});

// Models in the order of the brief. Sizes in meters: width_x, height_y, depth_z.
export const BRIEF = Object.freeze({
  'starship-lander': {
    kind: 'code-built',
    status: STATUS_LABELS.nasaSecondary,
    dimensions_m: { height_y: 52, width_x: 9, depth_z: 9 }, // 52 m tall, 9 m across
  },
  'habitat-unit': {
    kind: 'code-built',
    status: STATUS_LABELS.nasaStudy,
    parts: {
      'inflatable-section': { width_x: 6.5, height_y: 5.2, depth_z: 6.5 }, // about 6.5 m across, 5.2 m tall
      'metal-section': { width_x: 4.4, height_y: 2.6, depth_z: 4.4 }, // 4.4 m across, 2.6 m tall
    },
  },
  'fission-power-unit': {
    kind: 'code-built',
    status: STATUS_LABELS.nasaGoal,
    dimensions_m: { height_y: 6, depth_z: 4 }, // stowed cylinder; width_x includes illustrative radiators
    parts: {
      'stowed-body': { width_x: 4, height_y: 6, depth_z: 4 }, // 4 m wide, 6 m tall cylinder
    },
  },
  'solar-array-mast': {
    kind: 'code-built',
    status: STATUS_LABELS.ourEstimate,
    defaults: { height_m: 10, panel_width_m: 4 }, // parameters, default 10 m and 4 m
  },
  'griffin-lander': {
    kind: 'code-built',
    status: STATUS_LABELS.companySecondary,
    dimensions_m: { height_y: 2, width_x: 4.5 }, // about 2 m tall and 4.5 m wide
  },
  'blue-moon-mk1': {
    kind: 'imported',
    status: STATUS_LABELS.companySecondary,
    dimensions_m: { height_y: 8.05 }, // "8.05 meters tall" (SpaceNews, 12 Aug 2024, from the maker's FCC filing)
    author: 'David Nagy', // community CAD model, Onshape public document
    triangles: 18978, // the reduced CAD file, as given in the project plan
  },
  'viper-rover': {
    kind: 'generated',
    status: STATUS_LABELS.nasaFigure,
    dimensions_m: { height_y: 2.5 }, // 1.5 m by 1.5 m by 2.5 m (NASA Science, VIPER In Depth)
    picture_credit: 'Daniel Rutter, NASA Ames Research Center', // NASA image ACD20-0047
  },
  'crew-rover': {
    kind: 'generated',
    status: STATUS_LABELS.companyFigure,
    dimensions_m: { height_y: 2.6 }, // "about 2.6 meters to the top of its antenna" (maker's news page, 26 May 2026)
    picture_credit: 'Dan Lee-Odinson', // team member's own photo
  },
  'pressurized-rover': {
    kind: 'generated',
    status: STATUS_LABELS.jaxaFigure,
    dimensions_m: { height_y: 4.85 }, // L x W x H = 6.44 x 4.84 x 4.85 m (JAXA, 29 Sep 2025)
    picture_credit: 'Dan Lee-Odinson', // team member's own photo of a scale model
  },
  'hab-module': {
    kind: 'generated',
    status: STATUS_LABELS.ourEstimate,
    dimensions_m: { height_y: 4 }, // our estimate: NASA publishes no size for this concept
    picture_credit: 'NASA', // NASA rendering, "Conceptual Lunar Habitation Module"
  },
  'fission-surface-power': {
    kind: 'generated',
    status: STATUS_LABELS.ourEstimate,
    dimensions_m: { height_y: 6 }, // our estimate: the 6 m stowed length of NASA's 40 kWe goal, taken as the deployed height
    picture_credit: 'NASA', // NASA rendering of Kilopower on the Moon
  },
});
