# Planner module

A small Python package for the Lunar Landing Site Navigator. It holds the
hardware catalog as data, checks whether a payload fits a lander, and does the
power arithmetic for a site. Plain functions, no network, no third-party
packages at run time.

The backend imports it and calls four functions:

| Function | What it answers |
| --- | --- |
| `list_catalog()` | What hardware is in the catalog, with every figure's status label and source. |
| `fit_check(...)` | Does this payload fit this lander? Spare kilograms and margin percent. |
| `power_check(...)` | Do these power sources and this storage carry these loads, day and night? |
| `site_energy(...)` | How much energy does this site's darkness add (night penalty plus heating penalty)? |

One more function, `rocket_delta_v(...)`, works out delta-v with the rocket
equation and labels the answer `our estimate`.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [How a figure is stored](#how-a-figure-is-stored)
- [`list_catalog`](#list_catalogsectionnone)
- [`fit_check`](#fit_check)
- [`power_check`](#power_check)
- [`site_energy`](#site_energy)
- [`rocket_delta_v`](#rocket_delta_v)
- [Errors](#errors)
- [Decisions made in this module](#decisions-made-in-this-module)
- [Running the tests and the build](#running-the-tests-and-the-build)

## Install

Python 3.9 or newer. From the repository root:

```bash
pip install -e ./planner
```

Then, from anywhere:

```python
from planner import list_catalog, fit_check, power_check, site_energy
```

Without installing, put the `planner/` folder on the import path first
(`sys.path.insert(0, "planner")`), then import the same way.

## Quick start

```python
from planner import fit_check, power_check, site_energy

fit_check("blue_moon_mk1", ["astrolab_clv1"])["messages"][0]
# 'Blue Moon Mark 1: fits with 2,093 kg spare.'

loads = ["hab_crewed", "worksite_lighting", "comms_relay", "keep_alive_heat",
         "crew_rover_recharge", "crew_rover_keep_warm", "isru_pilot"]
result = power_check(loads, ["fission_100kwe"])
result["day"]["margin_percent"], result["day"]["status"]      # (57.8, 'green')
result["night"]["margin_percent"], result["night"]["status"]  # (78.66, 'green')

site_energy(["hab_uncrewed"], dark_hours=100)["total_kwh"]    # 539.0
```

Every function returns plain dictionaries, lists, strings, numbers, `True`,
`False` and `None`, so a result can go straight into `json.dumps`. Numbers are
not rounded; round them where you show them.

## How a figure is stored

The catalog is in `planner/data/catalog.json`. Each figure is stored in the
unit it was published in, and looks like this:

```json
{"value": 3000, "unit": "kg", "status": ["built", "company figure"],
 "source": "Blue Origin; Gunter's Space Page"}
```

| Key | Meaning |
| --- | --- |
| `value` | A number; a pair `[low, high]` for a range or a size; or `null` when not published. |
| `unit` | `kg`, `m`, `W`, `kW`, `kWh`, `h`, `m/s`, `deg` or `%`. |
| `status` | A list of status labels (see below). Usually one; `["built", "company figure"]` for flown or built hardware. |
| `source` | The source name. `source to add` where no source is named yet. |
| `qualifier` | Optional: `about`, `under` or `up to`, as published. |
| `kind` | For a pair: `range` (low to high) or `size` (for example 4 m by 6 m). |
| `default` | For a range used in a check: the end the check uses. |
| `status_inferred` | `true` where the label was not stated with the figure and was inferred (for example from the source name). Always comes with a `status_note`; to confirm. |
| `status_note`, `note` | Optional plain-language notes. |

**Status labels** (the only eight allowed): `built`, `company figure`,
`NASA figure`, `NASA goal`, `NASA study`, `university study`,
`research estimate`, `our estimate`.

Two markers appear in results:

- `user value` (source `typed by user`) - a number the user typed in place of
  a default. **Any default can be overridden** this way. It never appears in
  the catalog. Dark hours and longest darkness from the physics engine carry
  it too, with the source "given by the caller, such as the physics engine".
- `our estimate` - besides the catalog figures that carry this label, numbers
  this module works out itself, such as the default refill window.

In every request a field set to `None` (`null` in JSON) counts as not typed,
so the catalog default applies. A `None` list counts as an empty list.

**Ranges.** Where a published figure is a range, the default is the end that
makes a check harder to pass: the top for a load, the bottom for a power
source or a lander capacity. A figure published as "under X" or "up to X" uses
X, the harder end.

## `list_catalog(section=None)`

Returns the whole catalog as a dictionary (a fresh copy each call), or one
section of it.

Sections: `status_labels`, `default_rule`, `landers`, `payloads`,
`power_loads`, `power_sources`, `storage`, `heating`, `margin_rule`,
`constants`, `reference`.

```python
[lander["id"] for lander in list_catalog("landers")]
# ['blue_moon_mk1', 'blue_moon_mk2_cargo', 'starship_hls', 'griffin']
```

**Ids in the catalog**

| Section | Ids |
| --- | --- |
| landers | `blue_moon_mk1`, `blue_moon_mk2_cargo`, `starship_hls`, `griffin` |
| payloads | `astrolab_clv1`, `fsp_40kwe`, `surface_habitat`, `jaxa_pressurized_rover`, `logistics` |
| power_loads | `hab_crewed`, `hab_uncrewed`, `crew_rover_recharge`, `crew_rover_keep_warm`, `science_rover_recharge`, `pressurized_rover_recharge`, `worksite_lighting`, `keep_alive_heat`, `comms_relay`, `isru_pilot`, `isru_full_plant` |
| power_sources | `fission_100kwe`, `fission_40kwe`, `vsat`, `vsat_xl`, `hab_array`, `regenerative_fuel_cell` |
| reference | `dv_halo_to_surface_2018`, `dv_halo_to_surface_2019`, `dv_halo_to_surface_2023`, `crew_lander_tilt_threshold`, `crew_lander_tilt_goal`, `griffin_slope`, `apollo_sun_elevation`, `crew_rover_battery` |

`reference` values are labelled data for display only; no check uses them.

`get_item(section, id)` returns one entry. `validate_catalog()` returns a list
of problems with the data file (an empty list means it is well formed).

## `fit_check`

```python
fit_check(lander=None, payloads=(), capacity_kg=None, capacity_option=None)
```

Compares the total payload mass with the lander's payload to the surface.
**Mass only**; dimensions are stored but not compared.

| Parameter | Meaning |
| --- | --- |
| `lander` | A lander id. May be `None` if `capacity_kg` is typed. |
| `payloads` | A list. Each item is an id string, or a dictionary with any of `id`, `name`, `mass_kg` (overrides the catalog), `count` (default 1). A payload not in the catalog needs `name` and `mass_kg`. |
| `capacity_kg` | A typed capacity in kg; overrides the catalog. |
| `capacity_option` | Use one published capacity figure: `one_way` or `reusable` for Blue Moon Mark 2 cargo; `company` or `nasa_cargo_variants` for Starship HLS. |

**Result keys**

| Key | Meaning |
| --- | --- |
| `fits` | `True`, `False`, or `None` when it depends on the capacity figure or a mass is missing. |
| `verdict` | `fits`, `does not fit`, `depends on capacity figure` or `mass needed`. |
| `spare_kg` | Capacity minus payload. Negative means over. |
| `margin_percent` | Spare divided by capacity, times 100. |

`spare_kg` and `margin_percent` are `None` when there is more than one capacity
figure (read them in `checks`) or when a mass is missing.

| Key | Meaning |
| --- | --- |
| `checks` | One entry per capacity figure: `option`, `label`, `capacity_kg`, `capacity_figure` (status, source), `payload_kg`, `fits`, `spare_kg`, `margin_percent`. |
| `payload_total_kg`, `known_payload_kg` | Total mass; the total of the known masses. |
| `payloads` | One line per payload, with `unit_mass_kg`, `line_mass_kg`, `mass_from` (`catalog` or `user`) and `mass_figure` (status, source, qualifier). |
| `missing_masses` | Payloads with no published mass, each with a message asking for a typed value. |
| `messages` | Sentences ready to show. |

Starship HLS and Blue Moon Mark 2 cargo each have two published capacity
figures. Unless you pick one with `capacity_option`, the payload is checked
against both and neither is chosen for you.

```python
fit_check("blue_moon_mk1", ["fsp_40kwe"])
# fits False, spare_kg -3000.0, margin_percent -100.0,
# messages[0] 'Blue Moon Mark 1: does not fit: 3,000 kg over.'

fit_check("starship_hls", ["surface_habitat", "logistics"])["verdict"]
# 'depends on capacity figure'  (fits 100,000 kg; over the 12,000 kg cargo figure)

fit_check("griffin", ["jaxa_pressurized_rover"])["messages"][0]
# "Mass not published for JAXA pressurized rover. Type a value, for example
#  {'id': 'jaxa_pressurized_rover', 'mass_kg': <kg>}."

fit_check("griffin", [{"id": "jaxa_pressurized_rover", "mass_kg": 500}])["verdict"]
# 'fits'
```

## `power_check`

```python
power_check(loads=(), sources=(), storage_kwh=0.0,
            longest_darkness_h=None, refill_hours=None,
            radiator="deployed", uncrewed_hab_heating=None,
            heat_leak_w=None, radiator_protection_w=None,
            green_at_percent=None)
```

| Parameter | Meaning |
| --- | --- |
| `loads` | Ids from `power_loads`, or dictionaries with `id` plus any of `count`, `power_kw`, `energy_per_night_kwh`, `runs`, `use`. A custom load needs `name`, `runs` and `power_kw` or `energy_per_night_kwh`. |
| `sources` | Ids from `power_sources`, or dictionaries with `id` plus any of `count`, `power_kw`, `works`. A custom source needs `name`, `power_kw` and `works`. |
| `storage_kwh` | Typed storage in kWh. There is no default storage. |
| `longest_darkness_h` | Longest darkness at the site in hours, from the physics engine. |
| `refill_hours` | Sunlit hours to refill storage. Default: one lunar month (708.73 h) minus the longest darkness (never below 0), labelled `our estimate`. |
| `radiator`, `uncrewed_hab_heating`, `heat_leak_w`, `radiator_protection_w` | The heating model for an uncrewed habitat in darkness, the same as in `site_energy`. |
| `green_at_percent` | A typed green line; default 25. |

`runs` and `works` take `always` (day and night), `light` (sunlight only) or
`dark` (darkness only). Typed powers are in **kW** (140 W is `0.14`).
`use` picks a named power figure: `pressurized_rover_recharge` has `peak`
(9.5 kW, the default) and `average` (6.5 kW).

**The arithmetic**

- Margin percent = (available - load) / available x 100, rounded to 9 decimal
  places to remove floating-point noise (so 46.650000000000006 reads 46.65).
- Colour: **green** at 25 or more, **yellow** from 0 up to 25, **red** when
  negative. The 25 percent line is the Pre-Phase A value in GSFC-STD-1000
  Rev I, Table 1.06-1.
- **Day check:** sources working in sunlight (fission and solar) must cover
  the day load plus the power to refill storage. Refill power = energy taken
  from storage and from night-only sources / refill hours.
- **Night load** counts loads that run `always` or `dark`. An uncrewed
  habitat draws heat leak plus radiator protection in darkness (5.39 kW
  deployed, 2.25 kW stowed) in place of its flat 2 kW, unless its power or
  timing is typed or `uncrewed_hab_heating=False`.
- **Per-night energy items** (such as rover keep-warm) count only for loads
  that run in darkness, and only when there is darkness.
- **Night check, with `longest_darkness_h`:** storage must cover
  (night load - sources working in darkness) x longest darkness, plus the
  per-night energy items. Sources are used in this order: continuous sources,
  then night-only sources (the fuel cell), then storage.
  - When the sources working in darkness carry the whole night on their own,
    per-night items included, the night margin is their **power** margin
    (`basis`: "power: sources in darkness carry the night"). This is the
    worked example's 46.7 and 78.7 percent, whatever the darkness length.
  - When storage is needed, the night margin is the **energy** margin over the
    longest darkness (`basis`: "energy over the longest darkness"):
    available = sources in darkness x hours + storage;
    load = night load x hours + per-night items.
  - Both views are always returned: `power_margin_percent` and
    `energy_margin_percent`.
  - With `longest_darkness_h=0` there is no night to check (`status` "none").
- **Night check, without `longest_darkness_h`:** a power comparison only,
  sources in darkness against night load; storage and per-night items cannot
  be counted without a duration, and the refill is left out of the day check;
  a note says so.
- **Balance:** the worse of the day and night margins. `limiting` is "day",
  "night", or "day and night" when they tie.

**Result keys**

| Key | Meaning |
| --- | --- |
| `day` | `available`, `load` (day load plus refill), `unit` (kW), `load_kw`, `refill_kw`, `refill_kwh`, `refill_hours`, `surplus`, `margin_percent`, `status`, `passes`. |
| `night` | `basis`, `available`, `load`, `unit` (kW or kWh, following `basis`), `surplus`, `margin_percent`, `status`, `passes`, `load_kw`, `sources_kw`, `per_night_kwh`, `storage_kwh`, `storage_needed_kwh`, `power_margin_percent`, `energy_margin_percent`, and with a darkness length also `available_kwh`, `load_kwh`, `surplus_kwh`. |
| `heating` | Whether the heating model was applied, the watts used, with status and source. |
| `balance` | `margin_percent`, `status`, `limiting` (`day` or `night`). |
| `passes` | `True` when both checks pass. |
| `loads`, `sources` | One line each, with kW, timing, and status and source. |
| `notes` | Anything the check could not count. |

Worked example (night load 21.34 kW: habitat crewed 20 + lighting 1 + comms
0.2 + one keep-alive 0.14; one crew rover parked):

```python
site = ["hab_crewed", "worksite_lighting", "comms_relay", "keep_alive_heat",
        "crew_rover_recharge", "crew_rover_keep_warm"]

power_check(site, ["fission_40kwe"])["night"]["margin_percent"]    # 46.65 (46.7)
power_check(site, ["fission_100kwe"])["night"]["margin_percent"]   # 78.66 (78.7)

power_check(site + ["isru_pilot"], ["fission_100kwe"])["day"]["margin_percent"]  # 57.8
power_check(site + ["isru_pilot"], ["fission_40kwe"])["day"]["surplus"]          # -2.2 (kW over)

power_check(site, [], longest_darkness_h=72)["night"]["storage_needed_kwh"]   # 1546.18
power_check(site, [], longest_darkness_h=120)["night"]["storage_needed_kwh"]  # 2570.5 (about 2,571)

# With the physics engine's darkness, fission still reads 46.65 and 78.66:
power_check(site, ["fission_40kwe"], longest_darkness_h=72)["night"]["margin_percent"]  # 46.65
```

## `site_energy`

```python
site_energy(loads=(), dark_hours=None, dark_percent=None, months=1.0, nights=1,
            radiator="deployed", uncrewed_hab_heating=None,
            heat_leak_w=None, radiator_protection_w=None)
```

The energy a site adds through its darkness:

- Night penalty = night load x dark hours + per-night items x `nights`.
- Heating penalty, for an uncrewed habitat in darkness =
  (1,550 W heat leak + radiator protection) x dark hours. Radiator protection
  is 3,840 W deployed (the default) or about 700 W stowed. It **replaces** the
  flat 2 kW uncrewed load.
- Energy the site adds = night penalty + heating penalty.

| Parameter | Meaning |
| --- | --- |
| `loads` | The same load requests as `power_check`. |
| `dark_hours` | Dark hours from the physics engine. |
| `dark_percent`, `months` | Instead of `dark_hours`: a dark share in percent of `months` lunar months of 708.73 h. Give one of `dark_hours` or `dark_percent`. |
| `nights` | How many times per-night items apply. Default 1. With zero dark hours there is no night and they do not apply. |
| `radiator` | `deployed` or `stowed`. |
| `uncrewed_hab_heating` | `None`: heating model on for `hab_uncrewed` when its power and timing are not typed. `True`: on even without that load (one habitat). `False`: keep the flat 2 kW instead. |
| `heat_leak_w`, `radiator_protection_w` | Typed values that override the catalog. |

Result keys: `dark_hours`, `night_load_kw`, `per_night_kwh`,
`night_penalty_kwh`, `heating_penalty_kwh`, `total_kwh`, `heating` (the watts
used, with status and source), `loads`.

```python
site_energy(["hab_uncrewed"], dark_hours=100)["total_kwh"]                     # 539.0
site_energy(["hab_uncrewed"], dark_hours=100, radiator="stowed")["total_kwh"]  # 225.0
site_energy(["hab_crewed", "worksite_lighting", "comms_relay", "keep_alive_heat"],
            dark_percent=7.73)["night_penalty_kwh"]                            # 1169.1
```

The last line is the night load only; adding `crew_rover_keep_warm` adds
9.7 kWh.

Helpers: `dark_hours_from_percent(percent, months=1.0)`,
`margin_percent(available, load)`, `margin_status(margin, available, load)`,
`LUNAR_MONTH_HOURS` (708.73), `GREEN_AT_PERCENT` (25).

## `rocket_delta_v`

```python
rocket_delta_v(isp_s, dry_mass, propellant_mass, payload_mass=0.0, mass_unit="t")
```

The rocket equation for a stage that burns all its propellant:

delta-v = Isp x 9.80665 x ln(start mass / final mass)

- start mass = dry + propellant + payload
- final mass = dry + payload
- 9.80665 m/s^2 is standard gravity (`STANDARD_GRAVITY`, in the catalog
  constants)

| Parameter | Meaning |
| --- | --- |
| `isp_s` | Specific impulse in seconds (more than 0). |
| `dry_mass`, `propellant_mass`, `payload_mass` | Masses in any one unit; only their ratio matters. |
| `mass_unit` | The unit the masses were typed in, echoed back for display. Default `t`. |

The result is labelled `our estimate` and carries every input, so anyone can
redo the sum: `delta_v_m_s`, `status`, `source`, `formula`, `inputs`
(including `g0_m_s2`), `start_mass`, `final_mass`, `mass_ratio`, `message`.

```python
result = rocket_delta_v(380, dry_mass=85, propellant_mass=1200, payload_mass=100)
result["delta_v_m_s"]   # 7501.87...
result["message"]       # 'About 7,502 m/s (our estimate): 380 s x 9.80665 m/s^2 x ln(1385 t / 185 t).'
```

For comparison, `list_catalog("reference")` holds the published delta-v from
the Artemis halo orbit to the surface (2,850, 2,750 and 2,700 m/s). They are
reference values only; this function does not check against them.

## Errors

Bad input raises `planner.PlannerInputError` (a `ValueError`) with a message
written for a person, saying what to type instead, for example:

```
Unknown id 'eagle' in landers. Known ids: blue_moon_mk1, blue_moon_mk2_cargo, starship_hls, griffin.
```

A backend can catch it and return the message with a 400 status. A missing
published mass is **not** an error: `fit_check` returns `verdict: "mass needed"`
and asks for a typed value.

## Decisions made in this module

1. **One label set per entry.** Where a catalog entry gives one status and one
   source for several figures (for example Blue Moon Mark 1's capacity, height,
   width and fueled mass), every figure in the entry carries that status and
   source. Where the two sources are not split by figure, both are listed.
2. **"Built, company figure"** is stored as two labels: `["built", "company figure"]`.
3. **Inferred labels are flagged.** Eight figures had no label stated with
   them and carry an inferred one with `status_inferred: true` and a
   `status_note` asking the team to confirm: the 25 percent line and the
   NASA-sourced reference values carry `NASA figure`; the tilt goal `NASA goal`;
   Griffin's slope `company figure`; Apollo's Sun elevations `NASA figure`.
   The habitat's own array, the heat leak and both radiator figures carry
   `NASA study` as a confirmed label (team decision, 14 Nov 2026): they come
   from a NASA conceptual thermal design that is based on NASA's Surface
   Habitat reference design, and the source text says so.
4. **No source name invented.** Every unnamed source, including the team's own
   estimates, reads `source to add`. Figures with no label and nothing to infer
   it from (the JAXA pressurized rover's dimensions, the lunar month constant)
   have an empty status list and a `status_note`.
5. **Lander capacities** follow the power-source rule: the bottom of the
   Starship HLS cargo range (12,000 kg) is the default for that figure.
6. **Pressurized rover recharge** defaults to the 9.5 kW peak (the harder end);
   the 6.5 kW average is available with `use: "average"`.
7. **Rover charging** ("while charging") is placed in sunlight by default. The
   science and pressurized rovers have no published time of day and are
   treated the same. Any load's timing can be typed with `runs`.
8. **Regenerative fuel cell** counts as a source working in darkness; the
   energy it delivers is added to what must be refilled by day.
9. **Refill window** defaults to one lunar month minus the longest darkness,
   labelled `our estimate`; the physics engine should pass `refill_hours`.
   Refill uses the full storage need even when typed storage falls short.
10. **A margin of exactly 0** is yellow (it passes, with no margin to spare).
11. **Night margin basis.** When the sources working in darkness carry the
    night on their own, the night margin is their power margin, so the worked
    example's 46.7 and 78.7 percent hold whether or not the physics engine
    sends a darkness length, and typed spare storage does not inflate it. When
    storage is needed, it is the energy margin over the longest darkness.
12. **No storage losses** are modelled: storage returns what is put in.
13. **Uncrewed habitat heating applies in both checks.** `power_check` uses
    the same heating model as `site_energy`, so storage sized by one agrees
    with the energy counted by the other. A typed habitat power or timing is
    kept as typed.
14. **Per-night items need a night**: they count only for loads that run in
    darkness, and not at a site with no darkness.

## Running the tests and the build

```bash
cd planner
pip install pytest build
python -m pytest
python -m build
```

`tests/test_catalog.py` pins every figure in the catalog one by one (value,
unit, status, source, qualifier), so any change to a number shows up as a
failing test.
