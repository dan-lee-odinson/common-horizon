// The figures from the brief for this lane, written down once, for the check script only.
//
// This is deliberately a separate copy from the numbers inside the model scripts. The check
// compares three things that must agree: this brief, each model's JSON file, and the shape
// measured from its .glb. If someone changes a model script and its JSON together by mistake,
// the comparison with the brief still catches it.

export const TRIANGLE_LIMIT = 20000; // "Under 20,000 triangles each"
export const SIZE_TOLERANCE = 0.01; // "fails if a size is more than 1 percent off its JSON"
export const REQUIRED_NOTE = 'illustrative shape, built with SI/AI-written code';

export const STATUS_LABELS = Object.freeze({
  nasaSecondary: 'NASA figure, secondary source',
  nasaStudy: 'NASA study',
  nasaGoal: 'NASA goal',
  ourEstimate: 'our estimate, to be replaced by a published figure',
  companySecondary: 'company figure, secondary source',
});

// Models in the order of the brief. Sizes in meters: width_x, height_y, depth_z.
export const BRIEF = Object.freeze({
  'starship-lander': {
    status: STATUS_LABELS.nasaSecondary,
    dimensions_m: { height_y: 52, width_x: 9, depth_z: 9 }, // 52 m tall, 9 m across
  },
  'habitat-unit': {
    status: STATUS_LABELS.nasaStudy,
    parts: {
      'inflatable-section': { width_x: 6.5, height_y: 5.2, depth_z: 6.5 }, // about 6.5 m across, 5.2 m tall
      'metal-section': { width_x: 4.4, height_y: 2.6, depth_z: 4.4 }, // 4.4 m across, 2.6 m tall
    },
  },
  'fission-power-unit': {
    status: STATUS_LABELS.nasaGoal,
    dimensions_m: { height_y: 6, depth_z: 4 }, // stowed cylinder; width_x includes illustrative radiators
    parts: {
      'stowed-body': { width_x: 4, height_y: 6, depth_z: 4 }, // 4 m wide, 6 m tall cylinder
    },
  },
  'solar-array-mast': {
    status: STATUS_LABELS.ourEstimate,
    defaults: { height_m: 10, panel_width_m: 4 }, // parameters, default 10 m and 4 m
  },
  'griffin-lander': {
    status: STATUS_LABELS.companySecondary,
    dimensions_m: { height_y: 2, width_x: 4.5 }, // about 2 m tall and 4.5 m wide
  },
});
