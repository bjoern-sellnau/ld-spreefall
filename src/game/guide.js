// What the cheat menu does, in more words than the menu has room for: a
// line about each group, shown under its name until the pointer is on one
// of its settings and then about that one, and the guide behind the button
// at the bottom, which describes every setting in the menu.
//
// The guide is built from the same lists the menu is built from, so the two
// cannot drift apart: a switch added to the list is in the guide with it,
// and a check fails if it comes without a word about what it does.

export const GUIDE_GROUPS = [
  { id: 'actions', title: 'Right now',
    about: 'Things that happen once, straight away. Each one marks the run.' },
  { id: 'spawns', title: 'Bring more of them out',
    about: 'More of them in the streets round you, while you are on foot in a game. Each one marks the run.' },
  { id: 'rides', title: 'Something to get into',
    about: 'Parked a few metres away, or on its way down to you; F gets you in and out. Each one marks the run.' },
  { id: 'mine', title: 'Your mech',
    about: 'Which mech you are sent on the next titanfall, and by the mech button above. A choice: it does not mark the run.' },
  { id: 'foe', title: 'Their mechs',
    about: 'Which mechs come for you, or a different one every time. A choice: it does not mark the run.' },
  { id: 'bow', title: 'The bow',
    about: 'Which bow you carry, and how you hold it. A choice: it does not mark the run.' },
  { id: 'values', title: 'Numbers you can turn',
    about: 'The numbers behind some of the switches. One moved off where it starts marks the run; all off puts every one of them back.' },
  { id: 'tod', title: 'Time of day',
    about: 'The clock, for the light. It does not mark the run.' },
  { id: 'weather', title: 'Weather',
    about: 'The weather now, how strong it is, how often random turns, and lightning. It does not mark the run.' },
  { id: 'extreme', title: 'Extreme weather',
    about: 'Acid rain, an ion storm, a tornado and a firestorm, each switched on to come at random and announced twenty seconds ahead. Get under a bus shelter, a kiosk, the Brandenburg Gate or any other roof, or into a vehicle. It does not mark the run.' },
  { id: 'switches', title: 'Switches',
    about: 'On until you switch them off. Any one turned away from how the game ships marks the run; the two destruction switches start on.' },
  { id: 'gore', title: 'Gore',
    about: 'All off unless you say otherwise: the game without them has no blood in it at all. Each one on marks the run.' },
];

/** The controls the game layer builds itself rather than out of a list. */
export const CONTROL_HELP = {
  weatherOff: 'No weather at all: a clear sky whatever was picked on the game page, until it is pressed again.',
  intensity: 'How hard it rains, snows and blows, and how thick the fog is.',
  minutes: 'With random picked, how long the weather holds on average before it turns.',
  lightning: 'Whether a storm throws lightning and thunder.',
  extremeAll: 'All four on, or all four off. Switched on, they come at random, more than one at once if the dice say so.',
  extremeMinutes: 'On average how long between one and the next of those switched on; each wait is between half and one and a half times this.',
  extremeNow: 'Brings that one now, round where you are, with the twenty seconds of warning.',
  tod: 'Sets the clock: the sun, the sky and the shadows follow it, and after dark the street lamps and the windows light up.',
  close: 'Closes the menu. Everything stays as it is set.',
  reset: 'Every switch and gore setting back to how the game ships, and every number back to where it starts. The mechs, the bow, the time and the weather stay as they are.',
  guide: 'This guide: every setting in the menu, what it does, where it starts and what it is at now.',
};

const unitOf = (v, unit) => (v === 0 && unit === 's' ? 'never' : `${v} ${unit}`);
const onOff = (b) => (b ? 'on' : 'off');

/**
 * The guide: one section a group, in the order of the menu, each with a
 * line about the group and an entry a setting, saying what it does, the
 * range it goes over, where it starts, and where it is now.
 *
 * @param {object} d the lists the menu is built from, and the state now
 * @returns {{id:string, title:string, about:string,
 *   items:{label:string, help:string, range?:string, start?:string, now?:string}[]}[]}
 */
export function buildGuide(d) {
  const group = (id, items) => ({ ...GUIDE_GROUPS.find((g) => g.id === id), items });
  const n = d.now || {};
  const plain = (list) => list.map((x) => ({ label: x.label, help: x.help }));
  const pick = (list, picked) => list.map((x) => ({ label: x.label, help: x.help, now: x.id === picked ? 'picked' : undefined }));
  const toggles = (list) => list.map((x) => ({
    label: x.label, help: x.help, start: onOff(!!x.def), now: n.on ? onOff(n.on(x.id)) : undefined,
  }));
  const W = d.weatherLimits;
  const X = d.extremeLimits;
  return [
    group('actions', plain(d.actions)),
    group('spawns', plain(d.spawns)),
    group('rides', plain(d.rides)),
    group('mine', pick(d.chassis.mine, n.mine)),
    group('foe', pick(d.chassis.foe, n.foe)),
    group('bow', [...pick(d.bows, n.bow), ...pick(d.bowHolds, n.bowHold)]),
    group('values', d.settings.map((s) => ({
      label: s.label, help: s.help,
      range: `${unitOf(s.min, s.unit)} to ${unitOf(s.max, s.unit)}`,
      start: unitOf(s.def, s.unit),
      now: n.value ? unitOf(n.value(s.id), s.unit) : undefined,
    }))),
    group('tod', [{ label: 'Time of day', help: CONTROL_HELP.tod, range: '00:00 to 23:54', now: n.tod }]),
    group('weather', [
      { label: 'Off', help: CONTROL_HELP.weatherOff, start: 'off', now: n.weatherOff === undefined ? undefined : onOff(n.weatherOff) },
      ...pick(d.weatherKinds, n.weatherOff ? null : n.weather),
      { label: 'Weather strength', help: CONTROL_HELP.intensity,
        range: `${Math.round(W.intensityMin * 100)} to ${Math.round(W.intensityMax * 100)} %`, start: '100 %',
        now: n.intensity === undefined ? undefined : `${Math.round(n.intensity * 100)} %` },
      { label: 'Random weather turns every', help: CONTROL_HELP.minutes,
        range: `${W.minutesMin} to ${W.minutesMax} min`, start: `${W.minutes} min`,
        now: n.minutes === undefined ? undefined : `${n.minutes} min` },
      { label: 'Lightning', help: CONTROL_HELP.lightning, start: 'on', now: n.lightning === undefined ? undefined : onOff(n.lightning) },
    ]),
    group('extreme', [
      ...Object.entries(d.extremeKinds).map(([id, k]) => ({
        label: `${k.name} (${k.en})`, help: k.help, start: 'off',
        now: n.extreme ? onOff(!!n.extreme[id]) : undefined,
      })),
      { label: 'All', help: CONTROL_HELP.extremeAll },
      { label: 'Extreme weather every', help: CONTROL_HELP.extremeMinutes,
        range: `${X.minutesMin} to ${X.minutesMax} min`, start: `${X.minutes} min`,
        now: n.extremeMinutes === undefined ? undefined : `${n.extremeMinutes} min` },
      { label: 'Now: one of each', help: CONTROL_HELP.extremeNow },
    ]),
    group('switches', toggles(d.switches)),
    group('gore', toggles(d.gore)),
  ];
}
