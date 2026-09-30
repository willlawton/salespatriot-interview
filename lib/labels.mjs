// Human-readable labels. Set-aside codes are from DIBBS's official file spec.
// FSC and office names are the standard federal names; codes without a specific
// entry fall back to their 2-digit FSC group.

export const SET_ASIDE = {
  Y: 'Small business', H: 'HUBZone', R: 'SDVOSB', L: 'WOSB', A: '8(a)', E: 'EDWOSB', N: 'Unrestricted',
};

export const OFFICE = {
  SPE4A: 'DLA Aviation',
  SPE7M: 'DLA Land & Maritime',
  SPE7L: 'DLA Land & Maritime',
  SPE2D: 'DLA Troop Support – Medical',
  SPE8E: 'DLA Troop Support – Construction & Equipment',
  SPE1C: 'DLA Troop Support – Clothing & Textiles',
  SPE3S: 'DLA Troop Support – Subsistence',
};

const FSC_GROUP = {
  10: 'Weapons', 11: 'Nuclear ordnance', 12: 'Fire control equipment', 13: 'Ammunition & explosives',
  14: 'Guided missiles', 15: 'Aircraft & airframe structural components', 16: 'Aircraft components & accessories',
  17: 'Aircraft launching, landing & ground handling', 18: 'Space vehicles', 19: 'Ships, small craft & floating docks',
  20: 'Ship & marine equipment', 22: 'Railway equipment', 23: 'Motor vehicles, trailers & cycles', 24: 'Tractors',
  25: 'Vehicular equipment components', 26: 'Tires & tubes', 28: 'Engines, turbines & components',
  29: 'Engine accessories', 30: 'Mechanical power transmission equipment', 31: 'Bearings',
  32: 'Woodworking machinery', 34: 'Metalworking machinery', 35: 'Service & trade equipment',
  36: 'Special industry machinery', 37: 'Agricultural machinery', 38: 'Construction, mining & highway equipment',
  39: 'Materials handling equipment', 40: 'Rope, cable, chain & fittings', 41: 'Refrigeration & air conditioning',
  42: 'Fire fighting, rescue & safety equipment', 43: 'Pumps & compressors', 44: 'Furnace, steam plant & drying equipment',
  45: 'Plumbing, heating & waste disposal', 46: 'Water purification & sewage treatment', 47: 'Pipe, tubing, hose & fittings',
  48: 'Valves', 49: 'Maintenance & repair shop equipment', 51: 'Hand tools', 52: 'Measuring tools',
  53: 'Hardware & abrasives', 54: 'Prefabricated structures & scaffolding', 55: 'Lumber, millwork & plywood',
  56: 'Construction & building materials', 58: 'Communication, detection & coherent radiation equipment',
  59: 'Electrical & electronic components', 60: 'Fiber optics', 61: 'Electric wire & power distribution equipment',
  62: 'Lighting fixtures & lamps', 63: 'Alarm, signal & security detection systems',
  65: 'Medical, dental & veterinary equipment', 66: 'Instruments & laboratory equipment', 67: 'Photographic equipment',
  68: 'Chemicals & chemical products', 69: 'Training aids & devices', 70: 'IT equipment & software',
  71: 'Furniture', 72: 'Household & commercial furnishings', 73: 'Food preparation & serving equipment',
  74: 'Office machines', 75: 'Office supplies', 76: 'Books, maps & publications', 77: 'Musical instruments',
  78: 'Recreational & athletic equipment', 79: 'Cleaning equipment & supplies', 80: 'Brushes, paints, sealers & adhesives',
  81: 'Containers & packaging', 83: 'Textiles, leather, tents & flags', 84: 'Clothing & individual equipment',
  85: 'Toiletries', 87: 'Agricultural supplies', 88: 'Live animals', 89: 'Subsistence (food)',
  91: 'Fuels, lubricants, oils & waxes', 93: 'Nonmetallic fabricated materials', 94: 'Nonmetallic crude materials',
  95: 'Metal bars, sheets & shapes', 96: 'Ores & minerals', 99: 'Miscellaneous',
};

const FSC = {
  1560: 'Airframe structural components', 1615: 'Helicopter rotor blades & drive components', 1620: 'Aircraft landing gear components',
  1650: 'Aircraft hydraulic, vacuum & de-icing components', 1680: 'Misc. aircraft accessories & components',
  2530: 'Vehicle brake, steering, axle, wheel & track components', 2590: 'Misc. vehicular components',
  2840: 'Gas turbines & jet engines, aircraft', 2915: 'Engine fuel system components, nonaircraft',
  2995: 'Misc. engine accessories, aircraft', 3040: 'Misc. power transmission equipment', 3110: 'Bearings, antifriction',
  3120: 'Bearings, plain, unmounted', 4310: 'Compressors & vacuum pumps', 4320: 'Power & hand pumps',
  4330: 'Centrifugals, separators & filters', 4710: 'Pipe, tube & rigid tubing', 4720: 'Hose & flexible tubing',
  4730: 'Hose, pipe & tube fittings', 4810: 'Valves, powered', 4820: 'Valves, nonpowered', 5305: 'Screws', 5306: 'Bolts',
  5307: 'Studs', 5310: 'Nuts & washers', 5315: 'Nails, keys & pins', 5320: 'Rivets', 5325: 'Fastening devices',
  5330: 'Packing & gasket materials', 5331: 'O-rings', 5340: 'Hardware, commercial', 5355: 'Knobs & pointers',
  5360: 'Springs', 5365: 'Bushings, rings, shims & spacers', 5905: 'Resistors', 5910: 'Capacitors',
  5920: 'Fuses & circuit protection', 5930: 'Switches', 5935: 'Connectors, electrical', 5945: 'Relays & solenoids',
  5950: 'Coils & transformers', 5961: 'Semiconductor devices', 5962: 'Microcircuits, electronic',
  5975: 'Electrical hardware & supplies', 5985: 'Antennas & waveguides', 5995: 'Cable, cord & wire assemblies',
  5999: 'Misc. electrical & electronic components', 6105: 'Motors, electrical', 6145: 'Wire & cable, electrical',
  6150: 'Misc. electric power & distribution equipment', 6240: 'Electric lamps', 6505: 'Drugs & biologicals',
  6515: 'Medical & surgical instruments & supplies', 6520: 'Dental instruments & supplies',
  6530: 'Hospital furniture & equipment', 6532: 'Hospital & surgical clothing', 6640: 'Laboratory equipment & supplies',
  6680: 'Flow, level & motion measuring instruments', 6685: 'Pressure, temperature & humidity instruments',
  8415: 'Clothing, special purpose', 8465: 'Individual equipment', 9150: 'Oils & greases',
  9905: 'Signs & identification plates',
};

export const fscName = (code) => (code ? FSC[code] || FSC_GROUP[code.slice(0, 2)] || '' : '');
export const officeName = (prefix) => OFFICE[prefix] || '';
