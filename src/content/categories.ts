/** Starter category tree (T10). Edit freely; the seed only adds missing names. */
export const STARTER_CATEGORIES: { name: string; children: string[] }[] = [
  { name: "Power tools", children: ["Drills and drivers", "Saws", "Sanders and grinders"] },
  { name: "Hand tools", children: ["Wrenches and sockets", "Clamps", "Measuring"] },
  { name: "Yard and garden", children: ["Mowers and trimmers", "Pressure washers", "Digging"] },
  { name: "Ladders and access", children: [] },
  { name: "Camping and outdoors", children: ["Tents", "Cooking", "Coolers"] },
  { name: "Home and cleaning", children: ["Carpet and floor", "Painting"] },
  { name: "Kitchen and hosting", children: ["Appliances", "Tables and chairs"] },
  { name: "Electronics and AV", children: ["Projectors and screens", "Speakers"] },
  { name: "Sports and recreation", children: [] },
  { name: "Kids and baby", children: [] },
  { name: "Other", children: [] },
];

/** Items that can't be listed (D3). Shown before an item is saved. */
export const EXCLUDED_ITEMS = [
  "Weapons",
  "Vehicles",
  "Hazardous materials",
  "Medical devices",
  "Consumables",
];
