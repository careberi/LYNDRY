'use strict';

// ---------------------------------------------------------------------------
// THE 70 MUNICIPALITIES OF BERGEN COUNTY, AND ONE PARAGRAPH EACH.
//
// One row per town, one page per row, rendered by src/routes/locations.js. A
// data file rather than 70 HTML files: the only thing that differs between
// these pages is the town's name and its lead, and 70 copies of the same
// markup is 70 places for it to drift.
//
// THE LEAD IS THE WHOLE POINT OF THE FILE. Seventy pages that say the same
// thing with the name swapped are doorway pages, and Google has had a name for
// them since 2015. So every lead here is written once, by hand, and says
// something that is actually truer of that town than of the others.
//
// WHAT THEY MAY AND MAY NOT SAY:
//
//   MAY   - the shape of the housing, where the county's own boundaries are,
//           that the van is based in Fair Lawn, and anything about how the
//           service itself works.
//   MAY NOT - a mall, a school, a street, a station, a river, a population, a
//           nickname, or a "charming downtown". If a fact is not one I would
//           stake the business on, it is not on the page. Neil's rule: say "in
//           {Town} and the rest of Bergen County" rather than invent a landmark.
//
// So the variety comes from the SERVICE, seen from that town's doorstep -
// apartments and unit numbers in the dense east, long driveways in the
// north-west, no fixed route day in the highway towns - rather than from
// tourist copy about places I have never been.
//
// `angle` is only a note to whoever edits this next; nothing renders it.
// ---------------------------------------------------------------------------

// The van's home base, which is a real fact and the one piece of local colour
// every page is allowed to lean on.
const BASE = 'Fair Lawn';

const TOWNS = [
  {
    name: 'Allendale',
    slug: 'allendale',
    angle: 'single-family',
    lead:
      'Allendale is houses with driveways, and that suits this service: the bag goes ' +
      'out by the door and the driver walks up for it. Nobody waits in. You get it ' +
      'back washed and folded the next day, in the same spot you left it.',
  },
  {
    name: 'Alpine',
    slug: 'alpine',
    angle: 'single-family, long drives',
    lead:
      'Alpine has some of the longest driveways in the county, so tell us where the ' +
      'bag will actually be and the driver goes to that spot rather than guessing at ' +
      'a gate. Side door, garage, back porch. We use the same place on the way back.',
  },
  {
    name: 'Bergenfield',
    slug: 'bergenfield',
    angle: 'mixed housing',
    lead:
      'Bergenfield is a mix of houses and two-families, and the answer is the same for ' +
      'both: leave the bag where you told us, and it comes back there. If you are in ' +
      'the upstairs unit, put that on your address once and we have it for good.',
  },
  {
    name: 'Bogota',
    slug: 'bogota',
    angle: 'small borough',
    lead:
      'Bogota is small enough that a driver is never far from the next stop, which is ' +
      'why we can come on whatever day suits you rather than a fixed one. Text us a ' +
      'day. Leave the bag out that morning.',
  },
  {
    name: 'Carlstadt',
    slug: 'carlstadt',
    angle: 'highway/industrial',
    lead:
      'Carlstadt runs on its own hours, so there is no route day here to miss. Pick any ' +
      'day that works and we come to the door on it. We give you a window rather than a ' +
      'time, because a van crossing the county cannot promise a half hour.',
  },
  {
    name: 'Cliffside Park',
    slug: 'cliffside-park',
    angle: 'apartments/high-rise',
    lead:
      'Cliffside Park is apartment country, and the only thing we need is your unit ' +
      'number. The driver comes to your door, not to a lobby desk, and you do not need ' +
      'a doorman to hand anything over. Bag outside the door is enough.',
  },
  {
    name: 'Closter',
    slug: 'closter',
    angle: 'single-family',
    lead:
      'Closter is mostly single-family, so most pickups here are a bag on a step and ' +
      'nobody home. That is the normal way to use this. Tell us the spot once and the ' +
      'driver uses it every time, both directions.',
  },
  {
    name: 'Cresskill',
    slug: 'cresskill',
    angle: 'single-family',
    lead:
      'In Cresskill the usual arrangement is a bag by the front door before work and ' +
      'clean laundry in the same place the next day. You are not booking a visit, you ' +
      'are booking a day. Nobody has to be in for either end of it.',
  },
  {
    name: 'Demarest',
    slug: 'demarest',
    angle: 'single-family, wooded',
    lead:
      'Demarest is quiet, wooded and set back from the road in places, so the note on ' +
      'your address matters more here than the house number. Say which door. The driver ' +
      'reads it on every run, so you only write it once.',
  },
  {
    name: 'Dumont',
    slug: 'dumont',
    angle: 'mixed housing',
    lead:
      'Dumont is close-packed houses on small lots, which makes it quick to cover and ' +
      'easy to fit in on any weekday. Text a day, leave the bag out, get it back the ' +
      'next one. There is no route day to work around.',
  },
  {
    name: 'East Rutherford',
    slug: 'east-rutherford',
    angle: 'highway/event traffic',
    lead:
      'Traffic in East Rutherford depends entirely on what is on, which is exactly why ' +
      'we give a window rather than a time. Your bag does not care when the van gets ' +
      'there as long as it is out. It comes back the next day.',
  },
  {
    name: 'Edgewater',
    slug: 'edgewater',
    angle: 'apartments/high-rise',
    lead:
      'Edgewater is mostly buildings rather than houses, and the driver comes to your ' +
      'door inside it. Put the unit on your address once. If your building has a package ' +
      'room or a desk you would rather we used, say so in the note and we will.',
  },
  {
    name: 'Elmwood Park',
    slug: 'elmwood-park',
    angle: 'mixed, near base',
    lead:
      `Elmwood Park is next door to where the van is based in ${BASE}, so it is one of ` +
      'the easiest places in the county for us to reach on short notice. Houses and ' +
      'apartments both. Leave the bag out and it is back the next day.',
  },
  {
    name: 'Emerson',
    slug: 'emerson',
    angle: 'small borough',
    lead:
      'Emerson is a small borough and we treat it like the rest of the county: any day ' +
      'you like, no minimum number of pickups, nothing to join. One text books it and ' +
      'the bag goes out the morning you chose.',
  },
  {
    name: 'Englewood',
    slug: 'englewood',
    angle: 'mixed apartments and houses',
    lead:
      'Englewood has everything from apartment buildings to detached houses, and the ' +
      'service does not change between them. Unit number if you have one, a spot for the ' +
      'bag either way. The driver goes to the door.',
  },
  {
    name: 'Englewood Cliffs',
    slug: 'englewood-cliffs',
    angle: 'single-family',
    lead:
      'Englewood Cliffs is largely single-family, so the bag usually waits on a step ' +
      'while everybody is out. Nothing needs signing for. We text you when it has been ' +
      'picked up and again with a photo when it is back down.',
  },
  {
    name: 'Fair Lawn',
    slug: 'fair-lawn',
    angle: 'the base',
    lead:
      'Fair Lawn is where our van is based, which makes it the shortest run we do. It ' +
      'does not buy you a different price or a different promise, but it does mean we ' +
      'can usually fit a Fair Lawn pickup in on a day that is already busy.',
  },
  {
    name: 'Fairview',
    slug: 'fairview',
    angle: 'dense apartments',
    lead:
      'Fairview is dense and mostly multi-family, so put your floor and unit on the ' +
      'address and the driver comes to that door. No lobby drop, no parcel room unless ' +
      'you ask for one. The bag outside your door is all we need.',
  },
  {
    name: 'Fort Lee',
    slug: 'fort-lee',
    angle: 'high-rise',
    lead:
      'Fort Lee is high-rise living, and the two things that matter are your unit number ' +
      'and whether your building wants us at a desk or at your door. Tell us once. You ' +
      'do not need a doorman on duty for a bag to go out.',
  },
  {
    name: 'Franklin Lakes',
    slug: 'franklin-lakes',
    angle: 'large lots',
    lead:
      'Franklin Lakes is large lots and long approaches, so the note about where the bag ' +
      'sits does real work here. Front door, side entry, by the garage. The driver reads ' +
      'it before every stop and brings the clean laundry back to the same place.',
  },
  {
    name: 'Garfield',
    slug: 'garfield',
    angle: 'dense, multi-family',
    lead:
      'Garfield is close-set houses and two- and three-family homes, so say which unit ' +
      'is yours and the driver will not be knocking on your neighbour. Bag out, bag back, ' +
      'nobody home in between.',
  },
  {
    name: 'Glen Rock',
    slug: 'glen-rock',
    angle: 'near base, single-family',
    lead:
      `Glen Rock is a few minutes from the van's base in ${BASE} and is nearly all ` +
      'houses, so the usual pattern is a bag on the step before work. You will get a text ' +
      'when it has been picked up, and a photo when it is back at the door.',
  },
  {
    name: 'Hackensack',
    slug: 'hackensack',
    angle: 'county seat, apartments and offices',
    lead:
      'Hackensack is the county seat and has more apartment buildings than most towns ' +
      'here, so the unit number is the thing to get right. The driver comes to your door. ' +
      'Nothing has to be signed for and nobody has to be in.',
  },
  {
    name: 'Harrington Park',
    slug: 'harrington-park',
    angle: 'small, single-family',
    lead:
      'Harrington Park is small and almost entirely houses, which makes it about as ' +
      'simple as this gets: a bag by the door on the day you chose. It comes back the ' +
      'next day, folded, in the same spot.',
  },
  {
    name: 'Hasbrouck Heights',
    slug: 'hasbrouck-heights',
    angle: 'mixed',
    lead:
      'Hasbrouck Heights sits on a rise with a mix of houses and apartments, and either ' +
      'works the same way. Leave the bag where you said it would be. We text you at ' +
      'pickup and again when it is back.',
  },
  {
    name: 'Haworth',
    slug: 'haworth',
    angle: 'small, single-family',
    lead:
      'Haworth is one of the quieter boroughs and is nearly all single-family, so ' +
      'pickups here are usually a bag on a porch with the house empty. That is the ' +
      'intended way to use it, not a fallback.',
  },
  {
    name: 'Hillsdale',
    slug: 'hillsdale',
    angle: 'single-family',
    lead:
      'Hillsdale households tend to book the same weekday every week, and you can set ' +
      'that up so you never have to text again. Or just text when the pile gets big. ' +
      'Both are fine and neither costs anything extra.',
  },
  {
    name: 'Ho-Ho-Kus',
    slug: 'ho-ho-kus',
    angle: 'small, single-family',
    lead:
      'Ho-Ho-Kus is small, close to the base and almost all houses, so it is a quick ' +
      'stop for the van and an easy one for you. Bag by the door on the day you picked. ' +
      'Back the next day.',
  },
  {
    name: 'Leonia',
    slug: 'leonia',
    angle: 'mixed',
    lead:
      'Leonia is houses and small apartment buildings together, and the driver goes to ' +
      'the door in both cases. If yours is a unit, put the number on your address once ' +
      'and it is on every pickup after that.',
  },
  {
    name: 'Little Ferry',
    slug: 'little-ferry',
    angle: 'highway/mixed',
    lead:
      'Little Ferry is compact and easy to slot into a run, so there is no fixed day we ' +
      'come here. You pick the day. We give a window on it rather than a time, because ' +
      'a van crossing the county cannot promise a half hour.',
  },
  {
    name: 'Lodi',
    slug: 'lodi',
    angle: 'dense, multi-family',
    lead:
      'Lodi has a lot of two- and three-family houses, so the unit or floor is worth ' +
      'writing down once. After that the driver knows exactly which door. Bag out in the ' +
      'morning, clean laundry back the next day.',
  },
  {
    name: 'Lyndhurst',
    slug: 'lyndhurst',
    angle: 'mixed, apartments',
    lead:
      'Lyndhurst mixes houses with apartment buildings, and neither needs anybody home. ' +
      'Leave the bag where you told us and it is picked up and brought back to the same ' +
      'place. You get a text at each end.',
  },
  {
    name: 'Mahwah',
    slug: 'mahwah',
    angle: 'large, spread out',
    lead:
      'Mahwah is the largest town in the county by area and is spread out with it, so ' +
      'the note on your address earns its place: which door, which side, past which gate. ' +
      'The driver reads it before every stop.',
  },
  {
    name: 'Maywood',
    slug: 'maywood',
    angle: 'small, near base',
    lead:
      `Maywood is small and close to the van's base in ${BASE}, so it is one of the ` +
      'easier places for us to add a stop. Houses mostly. Bag by the door on your day and ' +
      'back the next.',
  },
  {
    name: 'Midland Park',
    slug: 'midland-park',
    angle: 'small borough',
    lead:
      'Midland Park is a small borough of mostly houses, and the arrangement is the same ' +
      'as everywhere else we go: any day you like, nothing to join, no minimum number of ' +
      'pickups. One text sets it up.',
  },
  {
    name: 'Montvale',
    slug: 'montvale',
    angle: 'single-family, north',
    lead:
      'Montvale sits at the top of the county, and being at the far end of the run ' +
      'changes nothing about what you pay or when you get it back. Bag out on your day, ' +
      'clean laundry back the next.',
  },
  {
    name: 'Moonachie',
    slug: 'moonachie',
    angle: 'small, industrial',
    lead:
      'Moonachie is small and mostly given over to business, but the houses here are ' +
      'served exactly like the rest of the county. Pick a day. Leave the bag out. It ' +
      'comes back the next day, folded.',
  },
  {
    name: 'New Milford',
    slug: 'new-milford',
    angle: 'single-family',
    lead:
      'New Milford is nearly all houses on modest lots, so a bag on the front step is ' +
      'the usual thing. You do not need to be there for it. We text when it has been ' +
      'picked up and send a photo when it is back down.',
  },
  {
    name: 'North Arlington',
    slug: 'north-arlington',
    angle: 'apartments, south end',
    lead:
      'North Arlington is at the southern tip of the county and has a good share of ' +
      'apartments, so the unit number is the one detail to get right. The driver comes to ' +
      'your door rather than a lobby, unless you ask otherwise.',
  },
  {
    name: 'Northvale',
    slug: 'northvale',
    angle: 'small, northern',
    lead:
      'Northvale is a small borough near the state line and is covered on the same terms ' +
      'as everywhere else: same price, same next-day return, no surcharge for being at ' +
      'the edge of the map.',
  },
  {
    name: 'Norwood',
    slug: 'norwood',
    angle: 'single-family',
    lead:
      'Norwood is quiet and mostly single-family, so most pickups here happen with ' +
      'nobody home. Tell us the spot once, and that is where the driver looks and where ' +
      'the clean laundry goes back.',
  },
  {
    name: 'Oakland',
    slug: 'oakland',
    angle: 'wooded, large lots',
    lead:
      'Oakland is hilly and wooded with houses set well back, which makes the note about ' +
      'where the bag sits genuinely useful rather than a formality. Say which door and ' +
      'the driver will use it every time.',
  },
  {
    name: 'Old Tappan',
    slug: 'old-tappan',
    angle: 'large lots',
    lead:
      'Old Tappan is larger lots and longer driveways, so nobody expects you to meet the ' +
      'van at the curb. Leave the bag where you said. It is picked up and returned to the ' +
      'same place the next day.',
  },
  {
    name: 'Oradell',
    slug: 'oradell',
    angle: 'single-family',
    lead:
      'Oradell is a small borough of houses, and the usual pattern is a weekly bag on a ' +
      'set day. You can put that on repeat so you never text again, or book it one bag at ' +
      'a time. Either costs the same.',
  },
  {
    name: 'Palisades Park',
    slug: 'palisades-park',
    angle: 'dense, multi-family',
    lead:
      'Palisades Park is dense and largely multi-family, so put the unit on your address ' +
      'and the driver goes to that door rather than the building entrance. No doorman ' +
      'required. Bag outside the door is enough.',
  },
  {
    name: 'Paramus',
    slug: 'paramus',
    angle: 'retail/highway',
    lead:
      'Paramus traffic is what it is, and it is the reason we quote a window rather than ' +
      'a time. It changes nothing about your end: the bag goes out in the morning and ' +
      'comes back the next day. There is no fixed route day here.',
  },
  {
    name: 'Park Ridge',
    slug: 'park-ridge',
    angle: 'small, single-family',
    lead:
      'Park Ridge is a compact borough of mostly houses, and pickups here are the plain ' +
      'version of this: a bag by the door, gone by the evening, back the next day washed ' +
      'and folded.',
  },
  {
    name: 'Ramsey',
    slug: 'ramsey',
    angle: 'northern, single-family',
    lead:
      'Ramsey is up at the northern end of the county and is covered on the same terms as ' +
      'anywhere else we go. Same price, same next-day turnaround, and no extra for the ' +
      'distance from the base.',
  },
  {
    name: 'Ridgefield',
    slug: 'ridgefield',
    angle: 'mixed',
    lead:
      'Ridgefield is a mix of houses and apartment buildings, and the driver goes to the ' +
      'door either way. If you are in a unit, write the number on your address once and ' +
      'it carries over to every pickup.',
  },
  {
    name: 'Ridgefield Park',
    slug: 'ridgefield-park',
    angle: 'village, mixed',
    lead:
      'Ridgefield Park is compact and easy to cover, so we can come on the day that suits ' +
      'you rather than a set one. Text a day. Put the bag out that morning and it is back ' +
      'the next.',
  },
  {
    name: 'Ridgewood',
    slug: 'ridgewood',
    angle: 'near base, single-family',
    lead:
      `Ridgewood is close to the van's base in ${BASE} and is mostly houses, so it is a ` +
      'straightforward run for us and a short wait for you. Leave the bag by the door on ' +
      'the day you picked.',
  },
  {
    name: 'River Edge',
    slug: 'river-edge',
    angle: 'small, single-family',
    lead:
      'River Edge is a small borough of houses, and the standing arrangement works well ' +
      'here: same weekday every week, nothing to remember. You can stop or skip it by ' +
      'text whenever you like.',
  },
  {
    name: 'River Vale',
    slug: 'river-vale',
    angle: 'single-family',
    lead:
      'River Vale is residential and low-density, which is the easy case for a doorstep ' +
      'service. Nobody needs to be home at either end. The bag goes out, and clean ' +
      'laundry lands in the same spot the next day.',
  },
  {
    name: 'Rochelle Park',
    slug: 'rochelle-park',
    angle: 'small, highway',
    lead:
      'Rochelle Park is small and sits between bigger neighbours, which makes it quick ' +
      'to reach on any day of the week. There is no route day to wait for. Pick the day ' +
      'that suits you.',
  },
  {
    name: 'Rockleigh',
    slug: 'rockleigh',
    angle: 'tiny - short page on purpose',
    short: true,
    lead:
      'Rockleigh is the smallest borough in the county, and it is served on exactly the ' +
      'same terms as the largest. Same price, same next-day return, same doorstep pickup.',
  },
  {
    name: 'Rutherford',
    slug: 'rutherford',
    angle: 'mixed, southern',
    lead:
      'Rutherford has houses, apartments and a fair few two-families, and none of them ' +
      'change how this works. Say which door or which unit once. The bag goes out on your ' +
      'day and comes back the next.',
  },
  {
    name: 'Saddle Brook',
    slug: 'saddle-brook',
    angle: 'near base, highway',
    lead:
      `Saddle Brook borders ${BASE}, where the van is based, so it is one of the closest ` +
      'stops we make. Any weekday works. We give you a window on the day rather than a ' +
      'fixed time.',
  },
  {
    name: 'Saddle River',
    slug: 'saddle-river',
    angle: 'large lots',
    lead:
      'Saddle River is large properties and long drives, so tell us the spot you actually ' +
      'want used and the driver goes there. Not the mailbox unless you say the mailbox. ' +
      'The clean laundry comes back to the same place.',
  },
  {
    name: 'South Hackensack',
    slug: 'south-hackensack',
    angle: 'tiny - short page on purpose',
    short: true,
    lead:
      'South Hackensack is one of the smallest municipalities in the county, and the ' +
      'coverage here is identical to everywhere else: doorstep pickup, next-day return, ' +
      'nothing to join.',
  },
  {
    name: 'Teaneck',
    slug: 'teaneck',
    angle: 'large, mixed',
    lead:
      'Teaneck is one of the bigger townships here and has houses and apartments in ' +
      'quantity, so the only thing we need from you is which door. Unit number if there ' +
      'is one. The driver comes to it rather than to a lobby.',
  },
  {
    name: 'Tenafly',
    slug: 'tenafly',
    angle: 'single-family',
    lead:
      'Tenafly is mostly houses with proper front paths, and the normal way to use this ' +
      'is to leave the bag out and go to work. You are told by text when it has been ' +
      'picked up, and shown a photo when it is back.',
  },
  {
    name: 'Teterboro',
    slug: 'teterboro',
    angle: 'tiny - short page on purpose',
    short: true,
    lead:
      'Teterboro has very few homes in it, but the ones that are here are served the same ' +
      'as the rest of the county. Same price, same next-day return, same doorstep pickup.',
  },
  {
    name: 'Upper Saddle River',
    slug: 'upper-saddle-river',
    angle: 'large lots, north',
    lead:
      'Upper Saddle River is large lots at the north end of the county, and being far ' +
      'from the base costs you nothing. What helps is a clear note about the door, since ' +
      'houses here are often well back from the road.',
  },
  {
    name: 'Waldwick',
    slug: 'waldwick',
    angle: 'small borough',
    lead:
      'Waldwick is a small borough of mostly houses, and weekly is the rhythm most ' +
      'households here settle into. Put it on repeat and you never text again, or book ' +
      'one bag at a time. Same price either way.',
  },
  {
    name: 'Wallington',
    slug: 'wallington',
    angle: 'dense, small',
    lead:
      'Wallington is small and closely built, with plenty of two-family houses, so the ' +
      'unit or floor is worth writing down once. After that the driver knows exactly ' +
      'which door to use.',
  },
  {
    name: 'Washington Township',
    slug: 'washington-township',
    angle: 'single-family',
    lead:
      'Washington Township is residential and low-density, so most pickups happen with ' +
      'the house empty. That is the point of it. The bag goes out where you said, and ' +
      'that is where the clean laundry comes back.',
  },
  {
    name: 'Westwood',
    slug: 'westwood',
    angle: 'mixed borough',
    lead:
      'Westwood has houses and apartments together, and both are picked up at the door. ' +
      'If yours is a unit, the number goes on your address once and stays there. Bag out ' +
      'in the morning, back the next day.',
  },
  {
    name: 'Woodcliff Lake',
    slug: 'woodcliff-lake',
    angle: 'large lots',
    lead:
      'Woodcliff Lake is larger lots and set-back houses, which is the case where the ' +
      'note about the door matters most. Say which one and the driver uses it every ' +
      'time, both on the way out and on the way back.',
  },
  {
    name: 'Wood-Ridge',
    slug: 'wood-ridge',
    angle: 'small borough',
    lead:
      'Wood-Ridge is a small borough with a mix of older houses and newer builds, and the ' +
      'service is the same across both. Pick a day, leave the bag out, and it is back the ' +
      'next one washed and folded.',
  },
  {
    name: 'Wyckoff',
    slug: 'wyckoff',
    angle: 'single-family, larger lots',
    lead:
      'Wyckoff is almost entirely single-family on generous lots, so nobody is meeting ' +
      'the van at the curb. Leave the bag at the door you named. It is picked up while ' +
      'you are out and returned to the same door.',
  },
];

// Fast lookup for the route, and a guard against a slug being typed twice.
const BY_SLUG = new Map();
for (const town of TOWNS) {
  if (BY_SLUG.has(town.slug)) throw new Error(`Two towns share the slug "${town.slug}"`);
  BY_SLUG.set(town.slug, town);
}

function bySlug(slug) {
  return BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}

// A to Z, grouped by first letter, for the hub's index.
function byLetter() {
  const groups = new Map();

  for (const town of [...TOWNS].sort((a, b) => a.name.localeCompare(b.name))) {
    const letter = town.name.charAt(0).toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(town);
  }

  return [...groups.entries()];
}

module.exports = { TOWNS, bySlug, byLetter, BASE };
