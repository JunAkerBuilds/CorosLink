// Which router each sport uses, how far it may go, and C-LINK's own BRouter profiles.
//
// The profiles are written out here (not shipped as .brf files) so the athlete's choices are baked in and the text is
// testable. What they fix over brouter.de's stock profiles: every `service=*` kind is priced on its own (parking
// aisles, driveways and drive-throughs are no longer as cheap as a quiet street, so loops don't cut through car
// parks), runners keep to sidewalks rather than the carriageway of busy roads, and the surface and climbing choices
// change the costs. BRouter can't reward climbing (negative costs break its search), so "hilly" is left to scoring.
import type { Elevation, RouteSport, Surface } from "../../../maps/types";
import { RoutingProblem } from "./net";
import { t } from "@/lib/i18n";

export type Router = "foot" | "road" | "mtb";

/** run, walk, hike → foot; road → road bike; mtb → mountain bike. */
export const routerFor = (sport: RouteSport): Router => (sport === "road" ? "road" : sport === "mtb" ? "mtb" : "foot");
export const isCycling = (sport: RouteSport) => routerFor(sport) !== "foot";

export const MAX_FOOT_KM = 100;
export const MAX_CYCLING_KM = 300;
export const maxKmFor = (sport: RouteSport) => (isCycling(sport) ? MAX_CYCLING_KM : MAX_FOOT_KM);

/** Refuses distances the router can't plan for this sport. */
export function checkDistance(sport: RouteSport, km: number): void {
  const max = maxKmFor(sport);
  if (!Number.isFinite(km) || km <= 0) throw new RoutingProblem(t("Pick a distance above zero."), "distance");
  if (km > max) {
    throw new RoutingProblem(isCycling(sport) ? t("Rides can be planned up to {max} km.", { max }) : t("Runs, walks and hikes can be planned up to {max} km.", { max }), "distance");
  }
}

/** brouter.de's own profiles, used only when ours can't be uploaded. */
export const STOCK_PROFILE: Record<Router, string> = { foot: "hiking-mountain", road: "fastbike", mtb: "mtb" };

export const SPORTS: readonly RouteSport[] = ["run", "walk", "hike", "road", "mtb"];
export const SURFACES: readonly Surface[] = ["road", "mixed", "trail"];
export const ELEVATIONS: readonly Elevation[] = ["any", "flat", "hilly"];

export interface Prefs { sport: RouteSport; surface: Surface; elevation: Elevation }
export interface ProfileOptions extends Prefs {
  /**
   * Drop the there-and-back BRouter makes to touch a via point. Right for points C-LINK placed (loop and sketch
   * vias); wrong for points the athlete clicked, where an out-and-back to a lookout is meant.
   */
  trimVias: boolean;
}

const TRAIL_WISH: Record<Surface, number> = { road: 0, mixed: 1, trail: 2 };
const yes = (b: boolean) => (b ? "true" : "false");

function climbCosts(elevation: Elevation, cycling: boolean) {
  if (elevation !== "flat") return { up: 0, upCut: 1.5, down: 0, downCut: 1.5 };
  return cycling ? { up: 60, upCut: 1.5, down: 30, downCut: 1.5 } : { up: 40, upCut: 1, down: 20, downCut: 1.5 };
}

export function profileText(o: ProfileOptions): string {
  return routerFor(o.sport) === "foot" ? footProfile(o) : bikeProfile(o);
}

const ROADS = "residential|living_street|unclassified|road|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|trunk|trunk_link";
const CLOSED = "motorway|motorway_link|proposed|construction|abandoned|raceway|platform|corridor|busway";

function globals(o: ProfileOptions, kind: "Foot" | "Bikes", wish = TRAIL_WISH[o.surface]): string {
  const c = climbCosts(o.elevation, kind === "Bikes");
  return `# C-LINK ${o.sport} profile (${o.surface}, ${o.elevation}${o.trimVias ? ", trimmed vias" : ""})
---context:global

assign validFor${kind} = true
assign turnInstructionMode = 0
assign considerTurnRestrictions = ${yes(kind === "Bikes")}
assign correctMisplacedViaPoints = ${yes(o.trimVias)}
assign correctMisplacedViaPointsDistance = 0
assign uphillcost = ${c.up}
assign uphillcutoff = ${c.upCut}
assign downhillcost = ${c.down}
assign downhillcutoff = ${c.downCut}
assign trailwish = ${wish}
`;
}

function footProfile(o: ProfileOptions): string {
  const stairs = o.sport === "hike" ? 1.15 : o.sport === "walk" ? 1.4 : 3;
  const sacLimit = o.sport === "run" && o.surface !== "trail" ? 2 : o.sport === "walk" ? 2 : 3;
  return `${globals(o, "Foot")}assign stairscost = ${stairs}
assign saclimit = ${sacLimit}

---context:way

assign paved = surface=paved|asphalt|concrete|paving_stones|sett|metal|wood
assign rough = or surface=ground|dirt|earth|grass|mud|sand|rock|stone|clay tracktype=grade4|grade5
assign walkside = or sidewalk=yes|both|left|right
                  or sidewalk:both=yes
                  or sidewalk:left=yes|designated sidewalk:right=yes|designated
assign marked = or route_foot_=yes
                or route_hiking_=yes
                or route_hiking_lwn=yes
                or route_hiking_rwn=yes route_hiking_nwn=yes
assign nodeaccessgranted = marked
assign street = highway=${ROADS}

assign allowed =
  if foot=yes|designated|permissive|destination then true
  else if foot=no|private then false
  else if highway=motorway|motorway_link then false
  else if motorroad=yes then false
  else if walkside then true
  else not access=private|no|military|permit

assign sac =
  if sac_scale=difficult_alpine_hiking|demanding_alpine_hiking|alpine_hiking then 4
  else if sac_scale=demanding_mountain_hiking then 3
  else if sac_scale=mountain_hiking then 2
  else if sac_scale=hiking|yes then 1
  else 0

assign pathcost =
  if equal trailwish 2 then ( if paved then 1.3 else 1 )
  else if equal trailwish 1 then ( if rough then 1.15 else 1 )
  else if paved then 1
  else if rough then 1.8
  else 1.15

assign servicecost =
  if service=parking_aisle|parking then 8
  else if service=drive-through then 25
  else if service=driveway then 6
  else if service=alley then 2
  else if walkside then 1.25
  else 1.6

assign roadcost =
  if highway=living_street then 1.1
  else if highway=residential then ( if walkside then 1.05 else 1.15 )
  else if highway=unclassified|road then ( if walkside then 1.1 else 1.4 )
  else if highway=tertiary|tertiary_link then ( if walkside then 1.2 else 2.2 )
  else if highway=secondary|secondary_link then ( if walkside then 1.35 else 3.5 )
  else if highway=primary|primary_link then ( if walkside then 1.6 else 6 )
  else if walkside then 2.5
  else 15

assign streetextra = if equal trailwish 2 then 0.5 else if equal trailwish 1 then 0.1 else 0

assign basecost =
  if route=ferry then 10000
  else if highway= then 10000
  else if highway=${CLOSED} then 10000
  else if highway=steps then stairscost
  else if highway=footway then ( if footway=sidewalk|crossing then ( if equal trailwish 2 then 1.4 else 1 ) else pathcost )
  else if highway=pedestrian then ( max 1.05 pathcost )
  else if highway=cycleway then ( add 0.05 pathcost )
  else if highway=path|track then pathcost
  else if highway=bridleway then ( add 0.6 pathcost )
  else if highway=service then ( add streetextra servicecost )
  else if street then ( add streetextra roadcost )
  else 2.5

assign unmarked = if marked then 0 else if equal trailwish 2 then 0.15 else 0

assign costfactor =
  if not allowed then 10000
  else if greater sac saclimit then 10000
  else if greater basecost 9999 then 10000
  else max 1 ( add basecost unmarked )

assign turncost = 0
assign initialcost = 0

assign priorityclassifier =
  if highway=motorway|trunk|primary|primary_link|trunk_link then 26
  else if highway=secondary|secondary_link then 24
  else if highway=tertiary|tertiary_link then 22
  else if highway=unclassified then 20
  else if highway=residential|living_street then 18
  else if highway=service then 14
  else if highway=footway|path|track|bridleway|cycleway|pedestrian|steps then 6
  else 0

---context:node

assign walkable =
  if nodeaccessgranted=yes then true
  else if foot=yes|designated|permissive then true
  else if foot=no|private then false
  else not access=private|no|permit

assign initialcost =
  if not walkable then 1000000
  else if highway=traffic_signals then 10
  else if crossing=traffic_signals then 10
  else 0
`;
}

function bikeProfile(o: ProfileOptions): string {
  const mtb = o.sport === "mtb";
  // A mountain bike never wants "road only": its least is gravel-friendly.
  const wish = mtb ? Math.max(1, TRAIL_WISH[o.surface]) : TRAIL_WISH[o.surface];
  return `${globals(o, "Bikes", wish)}assign mtblimit = ${mtb ? 3 : 1}

---context:way

assign paved = or surface=paved|asphalt|concrete|paving_stones smoothness=excellent|very_good|good
assign rough = or surface=ground|dirt|earth|grass|mud|sand|rock|stone|clay
               or tracktype=grade3|grade4|grade5 smoothness=bad|very_bad|horrible|very_horrible|impassable
assign gravel = and not paved not rough
assign unknownsurface = and surface= and tracktype= smoothness=
assign marked = or route_bicycle_icn=yes
                or route_bicycle_ncn=yes
                or route_bicycle_rcn=yes route_bicycle_lcn=yes
assign nodeaccessgranted = marked

assign allowed =
  if bicycle=yes|designated|permissive|destination then true
  else if bicycle=no|private|use_sidepath then false
  else if highway=motorway|motorway_link then false
  else if motorroad=yes then false
  else if highway=footway|pedestrian then false
  else not access=private|no|military|permit

assign pushing = and not allowed not foot=no|private

assign wrongway =
  if reversedirection=yes then ( if oneway:bicycle=yes then true else if oneway= then junction=roundabout else oneway=yes|true|1 )
  else oneway=-1
assign onewaycost =
  if not wrongway then 0
  else if oneway:bicycle=no then 0
  else if cycleway=opposite|opposite_lane|opposite_track then 0
  else 100

assign mtbscale =
  if mtb:scale=6|5|4 then 4
  else if mtb:scale=3 then 3
  else if mtb:scale=2-|2|2+ then 2
  else if mtb:scale=1-|1|1+ then 1
  else 0

assign offroadcost =
  if equal trailwish 0 then ( if paved then 1.5 else if gravel then 6 else if unknownsurface then 8 else 20 )
  else if equal trailwish 1 then ( if paved then 1.15 else if gravel then 1 else if unknownsurface then 1.3 else 2.2 )
  else if rough then 1
  else if gravel then 1.05
  else if unknownsurface then 1.1
  else 1.4

assign servicecost =
  if service=parking_aisle|parking then 8
  else if service=drive-through then 25
  else if service=driveway then 6
  else if service=alley then 2.2
  else 1.6

assign roadcost =
  if highway=trunk|trunk_link then 10
  else if highway=primary|primary_link then 1.4
  else if highway=secondary|secondary_link then 1.2
  else if highway=tertiary|tertiary_link then 1.05
  else if highway=unclassified|road then 1.1
  else 1.15

assign streetextra =
  if equal trailwish 2 then 0.6
  else if equal trailwish 1 then 0.15
  else if rough then 8
  else if gravel then 2
  else 0

assign basecost =
  if route=ferry then 10000
  else if highway= then 10000
  else if highway=${CLOSED} then 10000
  else if highway=steps then ( if equal trailwish 2 then 20 else 100 )
  else if highway=pedestrian then 4
  else if highway=cycleway then ( min 1.3 offroadcost )
  else if highway=track|path|footway|bridleway then offroadcost
  else if highway=service then ( add streetextra servicecost )
  else if highway=${ROADS} then ( add streetextra roadcost )
  else 3

assign accesscost = if allowed then 0 else if pushing then ( if equal trailwish 0 then 6 else 3 ) else 10000
assign markedbonus = if marked then ( if equal trailwish 2 then 0 else -0.1 ) else 0

assign costfactor =
  if greater basecost 9999 then 10000
  else if greater accesscost 9999 then 10000
  else if greater mtbscale mtblimit then 10000
  else min 9999 ( max 1 ( add basecost add markedbonus max onewaycost accesscost ) )

assign turncost = if junction=roundabout then 0 else ${mtb ? 30 : 60}
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

assign rideable =
  if nodeaccessgranted=yes then true
  else if bicycle=yes|designated|permissive then true
  else if bicycle=no|private|dismount then false
  else not access=private|no|permit

assign initialcost =
  if rideable then ( if highway=traffic_signals then 15 else 0 )
  else if foot=no|private then 1000000
  else 100
`;
}
