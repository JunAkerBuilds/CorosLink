import type {
  RouteActivityType,
  RouteElevationPreference,
  RouteSurfacePreference
} from "../types";

/**
 * CorosLink's own BRouter profiles, tuned for training rather than A-to-B
 * travel. The stock brouter.de profiles treat a parking aisle like any other
 * service road (cost ~1.2, barely above a residential street), so generated
 * runs happily cut through mall lots, driveways and drive-throughs. These
 * profiles price every `service=*` subtype separately, keep runners on
 * sidewalks rather than the carriageway of busy roads, honour the surface and
 * elevation preferences, and fall back to BRouter's own access rules.
 *
 * The text is generated (not shipped as .brf files) so options are baked in
 * and the exact profile is unit-testable. Upload happens in brouter.ts.
 */

export interface AthleteProfileOptions {
  activityType: RouteActivityType;
  surface: RouteSurfacePreference;
  elevation: RouteElevationPreference;
  /**
   * Remove the there-and-back detours BRouter adds to touch a via point.
   * Right for synthetic loop/sketch vias, wrong for points a user placed on
   * purpose (an out-and-back to a lookout is intentional).
   */
  trimViaDetours: boolean;
}

/** Default surface for each sport when the user has not picked one. */
export function defaultSurfaceForActivity(
  activityType: RouteActivityType
): RouteSurfacePreference {
  switch (activityType) {
    case "hiking":
    case "cycling-mountain":
      return "trail";
    default:
      return "road";
  }
}

export function normalizeSurfacePreference(
  value: unknown,
  activityType: RouteActivityType
): RouteSurfacePreference {
  return value === "road" || value === "mixed" || value === "trail"
    ? value
    : defaultSurfaceForActivity(activityType);
}

export function normalizeElevationPreference(
  value: unknown
): RouteElevationPreference {
  return value === "flatter" || value === "hilly" ? value : "any";
}

const SURFACE_INDEX: Record<RouteSurfacePreference, number> = {
  road: 0,
  mixed: 1,
  trail: 2
};

/** BRouter elevation costs: extra metres of cost per metre climbed past the cutoff gradient (%). */
function elevationCosts(
  elevation: RouteElevationPreference,
  cycling: boolean
): { uphill: number; uphillCutoff: number; downhill: number; downhillCutoff: number } {
  if (elevation === "flatter") {
    return cycling
      ? { uphill: 60, uphillCutoff: 1.5, downhill: 30, downhillCutoff: 1.5 }
      : { uphill: 40, uphillCutoff: 1.0, downhill: 20, downhillCutoff: 1.5 };
  }
  // BRouter cannot reward climbing (negative costs break the search), so
  // "hilly" is handled by candidate scoring in brouter.ts.
  return { uphill: 0, uphillCutoff: 1.5, downhill: 0, downhillCutoff: 1.5 };
}

function bool(value: boolean): string {
  return value ? "true" : "false";
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "");
}

export function buildAthleteProfile(options: AthleteProfileOptions): string {
  return options.activityType.startsWith("cycling")
    ? buildBikeProfile(options)
    : buildFootProfile(options);
}

/** Short human-readable key, also used as a cache key alongside the text hash. */
export function athleteProfileKey(options: AthleteProfileOptions): string {
  return [
    options.activityType,
    options.surface,
    options.elevation,
    options.trimViaDetours ? "trim" : "keep"
  ].join(":");
}

interface FootTuning {
  stepsCost: number;
  /** Highest sac_scale grade allowed (0 = none, 1 = T1 hiking … 6 = T6). */
  sacLimit: number;
  /** Penalise loud, built-up corridors and favour parks/water. */
  preferQuiet: boolean;
}

function footTuning(
  activityType: RouteActivityType,
  surface: RouteSurfacePreference
): FootTuning {
  switch (activityType) {
    case "hiking":
      return { stepsCost: 1.15, sacLimit: 3, preferQuiet: true };
    case "walking":
      return { stepsCost: 1.4, sacLimit: 2, preferQuiet: true };
    default:
      // Runners: stairs break rhythm; technical alpine paths are off the table.
      return { stepsCost: 3, sacLimit: surface === "trail" ? 3 : 2, preferQuiet: true };
  }
}

function buildFootProfile(options: AthleteProfileOptions): string {
  const tuning = footTuning(options.activityType, options.surface);
  const elevation = elevationCosts(options.elevation, false);
  return `# CorosLink athlete foot profile (${athleteProfileKey(options)})
---context:global

assign validForFoot = true
assign turnInstructionMode = 0
assign considerTurnRestrictions = false
assign correctMisplacedViaPoints = ${bool(options.trimViaDetours)}
assign correctMisplacedViaPointsDistance = 0

assign surface_pref = ${SURFACE_INDEX[options.surface]}
assign steps_cost = ${number(tuning.stepsCost)}
assign sac_limit = ${tuning.sacLimit}
assign prefer_quiet = ${bool(tuning.preferQuiet)}

assign uphillcost = ${number(elevation.uphill)}
assign uphillcutoff = ${number(elevation.uphillCutoff)}
assign downhillcost = ${number(elevation.downhill)}
assign downhillcutoff = ${number(elevation.downhillCutoff)}
assign elevationpenaltybuffer = 5
assign elevationmaxbuffer = 10

---context:way

assign ispaved = surface=paved|asphalt|concrete|paving_stones|sett|grass_paver|metal|wood
assign isrough = or surface=ground|dirt|earth|grass|mud|sand|rock|stone|clay
                 or tracktype=grade4|grade5
                    smoothness=bad|very_bad|horrible|very_horrible|impassable|off_road_wheels|high_clearance
assign isveryrough = or surface=mud|sand|rock|stone
                     or tracktype=grade5
                        smoothness=very_bad|horrible|very_horrible|impassable
assign issoft = and not ispaved not isrough

assign issidewalk = or sidewalk=yes|both|left|right
                    or sidewalk:both=yes
                    or sidewalk:left=yes|designated
                       sidewalk:right=yes|designated

assign isfootroute = or route_foot_=yes
                     or route_foot_lwn=yes
                     or route_foot_rwn=yes
                     or route_foot_nwn=yes
                     or route_hiking_=yes
                     or route_hiking_lwn=yes
                     or route_hiking_rwn=yes
                     or route_hiking_nwn=yes
                        route_hiking_iwn=yes

assign ispathlike = highway=footway|path|track|bridleway|cycleway|pedestrian|steps
assign isstreet = highway=residential|living_street|unclassified|road|service|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|trunk|trunk_link

assign nodeaccessgranted = isfootroute

# --- access ---------------------------------------------------------------
assign vehicleonlyaccess = access=private|no|military|permit
assign footaccess =
  if foot=yes|designated|permissive|destination then true
  else if foot=no|private then false
  else if highway=motorway|motorway_link then false
  else if motorroad=yes then false
  else if issidewalk then true
  else not vehicleonlyaccess

assign accesspenalty =
  if not footaccess then 10000
  else if foot=use_sidepath then 8
  else if access=customers|delivery then 3
  else if access=agricultural then 0.3
  else 0

# --- sac_scale (mountain paths) ------------------------------------------
assign sac =
  if sac_scale=difficult_alpine_hiking then 6
  else if sac_scale=demanding_alpine_hiking then 5
  else if sac_scale=alpine_hiking then 4
  else if sac_scale=demanding_mountain_hiking then 3
  else if sac_scale=mountain_hiking then 2
  else if sac_scale=hiking|T1-hiking|yes then 1
  else 0

assign sacpenalty =
  if greater sac sac_limit then 10000
  else if lesser sac 2 then 0
  else if equal surface_pref 2 then ( multiply 0.4 ( add sac -1 ) )
  else if equal surface_pref 1 then ( multiply 0.8 ( add sac -1 ) )
  else ( multiply 1.5 ( add sac -1 ) )

# --- path surfaces ---------------------------------------------------------
# Unknown surface: urban footways/cycleways are usually paved, paths and
# tracks usually are not.
assign pathpaved = or ispaved ( and surface= highway=footway|cycleway|pedestrian|steps )

assign pathcost =
  if equal surface_pref 0 then (
    if pathpaved then 1.0
    else if isveryrough then 3.0
    else if isrough then 1.6
    else 1.15 )
  else if equal surface_pref 1 then (
    if pathpaved then 1.0
    else if isveryrough then 2.0
    else if isrough then 1.15
    else 1.0 )
  else (
    if isveryrough then 1.6
    else if pathpaved then 1.3
    else 1.0 )

assign sidewalkcost = if equal surface_pref 2 then 1.45 else 1.0

# --- service roads: the parking-lot fix ------------------------------------
assign servicecost =
  if service=parking_aisle|parking then 8
  else if service=drive-through then 25
  else if service=driveway then 6
  else if service=alley then 2.0
  else if service=bus then 3
  else if service=yard|spur|siding|crossover then 4
  else if service=emergency_access|logging then 1.4
  else if issidewalk then 1.25
  else 1.6

# --- carriageways: cheap only when there is somewhere safe to run ----------
assign roadcost =
  if highway=living_street then 1.1
  else if highway=residential then ( if issidewalk then 1.05 else 1.15 )
  else if highway=unclassified|road then ( if issidewalk then 1.1 else 1.4 )
  else if highway=tertiary|tertiary_link then ( if issidewalk then 1.2 else 2.2 )
  else if highway=secondary|secondary_link then ( if issidewalk then 1.35 else 3.5 )
  else if highway=primary|primary_link then ( if issidewalk then 1.6 else 6 )
  else if highway=trunk|trunk_link then ( if issidewalk then 2.5 else 15 )
  else 2.5

# Trail seekers pay extra for every street; road runners pay a little for
# rough streets.
assign streetextra =
  if equal surface_pref 2 then 0.5
  else if equal surface_pref 1 then 0.1
  else if isrough then 0.4
  else 0

assign basecost =
  if and highway= not route=ferry then 10000
  else if route=ferry then 10000
  else if highway=motorway|motorway_link|proposed|construction|abandoned|raceway|corridor|via_ferrata|busway|platform then 10000
  else if highway=steps then steps_cost
  else if highway=footway then (
    if footway=crossing then 1.0
    else if footway=sidewalk then sidewalkcost
    else pathcost )
  else if highway=pedestrian then ( max 1.05 pathcost )
  else if highway=cycleway then ( add 0.05 pathcost )
  else if highway=path|track then pathcost
  else if highway=bridleway then ( add 0.6 pathcost )
  else if highway=service then ( add streetextra servicecost )
  else if isstreet then ( add streetextra roadcost )
  else 2.5

# --- comfort ---------------------------------------------------------------
assign informalpenalty =
  if not informal=yes then 0
  else if equal surface_pref 2 then 0
  else if equal surface_pref 1 then 0.3
  else 0.8

assign visibilitypenalty =
  if trail_visibility=no then 3
  else if trail_visibility=horrible then 1.5
  else if trail_visibility=bad then 0.6
  else 0

# Traffic only matters while on the carriageway itself.
assign trafficpenalty =
  if not isstreet then 0
  else multiply ( if issidewalk then 0.33 else 1 ) (
    if estimated_traffic_class=3 then 0.3
    else if estimated_traffic_class=4 then 0.7
    else if estimated_traffic_class=5 then 1.2
    else if estimated_traffic_class=6|7 then 2.0
    else 0 )

assign quietpenalty =
  if not prefer_quiet then 0
  else add (
    if estimated_noise_class=6 then 0.5
    else if estimated_noise_class=5 then 0.35
    else if estimated_noise_class=4 then 0.2
    else if estimated_noise_class=3 then 0.1
    else 0 ) (
    if estimated_forest_class=4|5|6 then 0
    else if estimated_forest_class=3 then 0.03
    else if estimated_forest_class=2 then 0.06
    else 0.1 )

assign routepenalty =
  if isfootroute then 0
  else if equal surface_pref 2 then 0.15
  else 0

assign penalties = add accesspenalty
                   add sacpenalty
                   add informalpenalty
                   add visibilitypenalty
                   add trafficpenalty
                   add quietpenalty
                       routepenalty

assign costfactor =
  if greater basecost 9999 then 10000
  else if greater accesspenalty 9999 then 10000
  else if greater sacpenalty 9999 then 10000
  else min 9999 ( max 1.0 ( add basecost penalties ) )

assign turncost = 0
assign initialcost = 0

assign priorityclassifier =
  if highway=motorway|trunk|primary|primary_link|trunk_link then 26
  else if highway=secondary|secondary_link then 24
  else if highway=tertiary|tertiary_link then 22
  else if highway=unclassified then 20
  else if highway=residential|living_street then 18
  else if highway=service then 14
  else if ispathlike then 6
  else 0

---context:node

assign defaultaccess =
  if access= then true
  else not access=private|no|permit

assign footaccess =
  if nodeaccessgranted=yes then true
  else if foot=yes|designated|permissive then true
  else if foot=no|private then false
  else defaultaccess

# Every set of lights is a stop on a tempo run.
assign initialcost =
  if not footaccess then 1000000
  else if highway=traffic_signals then 10
  else if crossing=traffic_signals then 10
  else 0
`;
}

interface BikeTuning {
  /** Cost multiplier family: 0 road bike, 1 gravel-ish, 2 mountain bike. */
  surfaceIndex: number;
  mtbScaleLimit: number;
  trafficWeight: number;
}

function bikeTuning(options: AthleteProfileOptions): BikeTuning {
  const surfaceIndex =
    options.activityType === "cycling-mountain"
      ? Math.max(1, SURFACE_INDEX[options.surface])
      : SURFACE_INDEX[options.surface];
  return {
    surfaceIndex,
    mtbScaleLimit: options.activityType === "cycling-mountain" ? 3 : 1,
    trafficWeight: options.activityType === "cycling-road" ? 0.6 : 0.8
  };
}

function buildBikeProfile(options: AthleteProfileOptions): string {
  const tuning = bikeTuning(options);
  const elevation = elevationCosts(options.elevation, true);
  return `# CorosLink athlete bike profile (${athleteProfileKey(options)})
---context:global

assign validForBikes = true
assign turnInstructionMode = 0
assign considerTurnRestrictions = true
assign correctMisplacedViaPoints = ${bool(options.trimViaDetours)}
assign correctMisplacedViaPointsDistance = 0

assign surface_pref = ${tuning.surfaceIndex}
assign mtb_limit = ${tuning.mtbScaleLimit}
assign traffic_weight = ${number(tuning.trafficWeight)}

assign uphillcost = ${number(elevation.uphill)}
assign uphillcutoff = ${number(elevation.uphillCutoff)}
assign downhillcost = ${number(elevation.downhill)}
assign downhillcutoff = ${number(elevation.downhillCutoff)}

# Kinematic model for the time estimate (road bike vs. MTB)
assign totalMass = 85
assign maxSpeed = ${options.activityType === "cycling-road" ? 50 : 35}
assign S_C_x = ${options.activityType === "cycling-road" ? "0.225" : "0.4"}
assign C_r = ${options.activityType === "cycling-road" ? "0.006" : "0.015"}
assign bikerPower = ${options.activityType === "cycling-road" ? 170 : 150}

---context:way

assign ispaved = or surface=paved|asphalt|concrete|paving_stones
                 smoothness=excellent|very_good|good
assign isrough = or surface=ground|dirt|earth|grass|mud|sand|rock|stone|clay
                 or tracktype=grade3|grade4|grade5
                    smoothness=bad|very_bad|horrible|very_horrible|impassable|off_road_wheels|high_clearance|rough
assign isgravel = and not ispaved not isrough
assign isunknownsurface = and surface= and tracktype= smoothness=

assign any_cycleroute = or route_bicycle_icn=yes
                        or route_bicycle_ncn=yes
                        or route_bicycle_rcn=yes
                           route_bicycle_lcn=yes
assign any_mtbroute = or route_mtb_=yes
                      or route_mtb_lcn=yes
                      or route_mtb_rcn=yes
                      or route_mtb_ncn=yes
                         route_bicycle_mtb=yes
assign nodeaccessgranted = or any_cycleroute lcn=yes

assign hascycleway = not
  and ( or cycleway= cycleway=no|none )
  and ( or cycleway:left= cycleway:left=no )
  and ( or cycleway:right= cycleway:right=no )
      ( or cycleway:both= cycleway:both=no )

# --- access (from BRouter's fastbike) --------------------------------------
assign defaultaccess =
  switch access=
    ( if motorroad=yes then false else not highway=motorway|motorway_link )
    ( not access=private|no|military|permit )

assign bikeaccess =
  switch bicycle=
    switch bicycle_road=yes true
      switch vehicle=
        ( if highway=footway|pedestrian then false else defaultaccess )
        ( not vehicle=private|no )
    ( not bicycle=private|no|dismount|use_sidepath )

assign footaccess =
  or bicycle=dismount
    switch foot= defaultaccess ( not foot=private|no|use_sidepath )

assign accesspenalty =
  if bikeaccess then ( if access=customers|delivery then 3 else 0 )
  else if footaccess then ( if equal surface_pref 0 then 6 else 3 )
  else if bicycle=use_sidepath then 25
  else 10000

assign badoneway =
  if reversedirection=yes then
    ( if oneway:bicycle=yes then true
      else if oneway= then junction=roundabout
      else oneway=yes|true|1 )
  else oneway=-1

assign onewaypenalty =
  if not badoneway then 0
  else if oneway:bicycle=no then 0
  else if cycleway=opposite|opposite_lane|opposite_track then 0
  else if not footaccess then 100
  else if junction=roundabout|circular then 60
  else if highway=primary|primary_link then 50
  else if highway=secondary|secondary_link then 30
  else if highway=tertiary|tertiary_link then 20
  else 6

# --- mountain-bike difficulty ----------------------------------------------
assign mtbscale =
  if mtb:scale=6|5 then 5
  else if mtb:scale=4 then 4
  else if mtb:scale=3 then 3
  else if mtb:scale=2-|2|2+ then 2
  else if mtb:scale=1-|1|1+ then 1
  else 0

assign mtbpenalty =
  if greater mtbscale mtb_limit then 10000
  else if equal surface_pref 2 then 0
  else multiply 2 mtbscale

# --- off-road ways ---------------------------------------------------------
assign offroadcost =
  if equal surface_pref 0 then (
    if ispaved then ( if bicycle=designated then 1.15 else 1.5 )
    else if isgravel then ( if tracktype=grade1 then 3 else 6 )
    else if isunknownsurface then ( if highway=cycleway then 1.3 else 8 )
    else 20 )
  else if equal surface_pref 1 then (
    if ispaved then 1.15
    else if isgravel then 1.0
    else if isunknownsurface then 1.3
    else 2.2 )
  else (
    if isrough then 1.0
    else if isgravel then 1.05
    else if isunknownsurface then 1.1
    else 1.4 )

# --- service roads: the parking-lot fix ------------------------------------
assign servicecost =
  if service=parking_aisle|parking then 8
  else if service=drive-through then 25
  else if service=driveway then 6
  else if service=alley then 2.2
  else if service=bus then 4
  else if service=yard|spur|siding|crossover then 5
  else if service=emergency_access|logging then ( if equal surface_pref 0 then 2 else 1.3 )
  else 1.6

assign roadcost =
  if highway=trunk|trunk_link then 10
  else if highway=primary|primary_link then 1.4
  else if highway=secondary|secondary_link then 1.2
  else if highway=tertiary|tertiary_link then 1.05
  else if highway=unclassified|road then 1.1
  else if highway=residential|living_street then 1.15
  else 2.5

# Mountain bikers pay to stay on pavement; roadies pay for broken tarmac.
assign streetextra =
  if equal surface_pref 2 then 0.6
  else if equal surface_pref 1 then 0.15
  else if isrough then 8
  else if isgravel then 2
  else 0

assign trafficpenalty =
  multiply traffic_weight
  multiply ( if hascycleway then 0.35 else 1 ) (
    if estimated_traffic_class=3 then 0.3
    else if estimated_traffic_class=4 then 0.6
    else if estimated_traffic_class=5 then 0.9
    else if estimated_traffic_class=6|7 then 1.5
    else 0 )

assign isroad = highway=residential|living_street|unclassified|road|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|trunk|trunk_link

assign basecost =
  if and highway= not route=ferry then 10000
  else if route=ferry then 10000
  else if highway=motorway|motorway_link|proposed|construction|abandoned|raceway|corridor|via_ferrata|busway|platform then 10000
  else if highway=steps then ( if equal surface_pref 2 then 20 else 100 )
  else if highway=pedestrian then 4
  else if highway=cycleway then ( min 1.3 offroadcost )
  else if highway=track|path|footway|bridleway then offroadcost
  else if highway=service then ( add streetextra servicecost )
  else if isroad then ( add ( add streetextra trafficpenalty ) roadcost )
  else 3

assign routebonus =
  if any_cycleroute then ( if equal surface_pref 2 then 0 else -0.1 )
  else if any_mtbroute then ( if equal surface_pref 2 then -0.15 else 0 )
  else 0

assign costfactor =
  if greater basecost 9999 then 10000
  else if greater accesspenalty 9999 then 10000
  else if greater mtbpenalty 9999 then 10000
  else min 9999 ( max 1.0 ( add basecost add routebonus add mtbpenalty max onewaypenalty accesspenalty ) )

assign turncost = if junction=roundabout then 0 else ${options.activityType === "cycling-road" ? 60 : 30}
assign initialcost = 0

assign priorityclassifier =
  if highway=motorway|trunk|primary|primary_link|trunk_link then 26
  else if highway=secondary|secondary_link then 24
  else if highway=tertiary|tertiary_link then 22
  else if highway=unclassified then 20
  else if highway=residential|living_street then 18
  else if highway=service|cycleway then 14
  else if highway=track|path|footway|bridleway then 6
  else 0

---context:node

assign defaultaccess =
  if access= then true
  else not access=private|no|permit

assign bikeaccess =
  if nodeaccessgranted=yes then true
  else if bicycle=yes|designated|permissive then true
  else if bicycle=no|private|dismount then false
  else if vehicle=no|private then false
  else defaultaccess

assign footaccess =
  if bicycle=dismount then true
  else if foot=no|private then false
  else defaultaccess

assign initialcost =
  if bikeaccess then ( if highway=traffic_signals then 15 else 0 )
  else if footaccess then 100
  else 1000000
`;
}
