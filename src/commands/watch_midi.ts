import { Readable } from "stream";
import { Bindings, readConfig } from "../config";
import { Device, Range } from "../devices";
import { apcKey25 } from "../devices/apcKey25";
import { debug, error, log } from "../logger";
import {
  amidiSend,
  ByteTriplet,
  MidiEvent,
  MidiEventType,
  watchMidi,
} from "../midi";
import { midiEventToMidish, midish } from "../midi/midish";
import { defaultLEDStates, run, buttonLEDBytes } from "../util";

const deviceRe = /^IO\s+([a-zA-Z0-9:,]+)\s+(.*?)$/;

// TODO: stop hard-coding this later
const HW_MIDI = "hw:5,1";

const MAP_FUNCTIONS = {
  IDENTITY: (input: any) => input,
  SQUARED: (input: number) => input * input,
  SQRT: (input: number) => Math.sqrt(input),
};

function handleNoteOn(
  event: MidiEvent,
  devMapping: Device,
  bindings: Bindings,
  midishIn: Readable,
  state: WatchMidiState
) {
  if (event.type !== MidiEventType.NoteOn) {
    return;
  }

  if (event.channel === devMapping.keys.channel) {
    debug(`Key ${event.note} velocity ${event.velocity}`);
    return;
  }

  const key = `${event.channel}:${event.note}`;
  const button = devMapping.buttons[key];
  if (button === undefined) {
    return;
  }

  if (button.label === "Shift") {
    // shift key is inverted for some reason
    debug("Shift OFF");
    state.shiftPressed = false;
    return;
  }

  debug(`[button pressed] ${button.label}`);
  let binding = bindings[button.label];
  if (binding !== undefined) {
    if (binding.type === "cycle") {
      if (state.buttons[button.label] === undefined) {
        state.buttons[button.label] = 1;
      } else {
        state.buttons[button.label] =
          (state.buttons[button.label] + 1) % binding.items.length;
      }

      const newBind = binding.items[state.buttons[button.label]];
      if (newBind.color !== undefined) {
        const data = buttonLEDBytes(
          button,
          newBind.color,
          event.channel,
          event.note
        );
        if (data !== undefined) {
          amidiSend(HW_MIDI, [data]).catch((err) => {
            error(`failed to send midi to amidi: `, err);
          });
        }
      }

      binding = newBind.bind;
    }

    if (binding.type === "command") {
      run(binding.command);
    } else if (binding.type === "mute") {
      const bDial = binding.dial;
      const dialBinding = Object.entries(bindings).find(
        ([dial]) => dial === bDial
      );

      if (dialBinding === undefined || dialBinding[1].type !== "passthrough") {
        error(`No matching binding for dial "${bDial}"`);
        return;
      }

      let controlVal = 0;
      let ledBytes: ByteTriplet | undefined = undefined;

      if (state.mutes[binding.dial]) {
        state.mutes[binding.dial] = false;
        controlVal = state.dials[binding.dial] ?? 0;
        ledBytes = buttonLEDBytes(button, "GREEN", event.channel, event.note);
      } else {
        state.mutes[binding.dial] = true;
        ledBytes = buttonLEDBytes(button, "RED", event.channel, event.note);
      }

      midishIn.push(
        midiEventToMidish({
          type: MidiEventType.ControlChange,
          channel: dialBinding[1].outChannel,
          controller: dialBinding[1].outController,
          value: controlVal,
        })
      );

      if (ledBytes !== undefined) {
        amidiSend(HW_MIDI, [ledBytes]).catch((err) => {
          error(`failed to send midi to amidi: `, err);
        });
      }
    } else if (binding.type === "midi") {
      const ev = binding.event;
      const midishCmd = midiEventToMidish(ev);
      midishIn.push(midishCmd);
    } else if (binding.type === "range") {
      const newIdx =
        (state.ranges[binding.dial].idx + 1) % binding.modes.length;
      const newMode = binding.modes[newIdx];
      state.ranges[binding.dial] = {
        range: newMode.range,
        idx: newIdx,
      };

      const data = buttonLEDBytes(
        button,
        newMode.color,
        event.channel,
        event.note
      );

      if (data !== undefined) {
        amidiSend(HW_MIDI, [data]).catch((err) => {
          error(`failed to send midi to amidi: `, err);
        });
      }
    }

    return;
  }

  // default behavior for button that isn't bound to anything.
  // just cycle through the colors
  if (button.ledStates !== undefined) {
    const ledStates = Object.keys(button.ledStates).filter(
      (state) => !state.includes("FLASHING")
    );
    const numLedStates = ledStates.length;
    if (!state.buttons[key]) {
      state.buttons[key] = 1;
    } else {
      state.buttons[key] = (state.buttons[key] + 1) % numLedStates;
    }

    const data = {
      b1: (0b1001 << 4) | event.channel,
      b2: event.note,
      b3: button.ledStates[ledStates[state.buttons[key]]],
    };
    amidiSend(HW_MIDI, [data]);
  }
}

function handleNoteOff(
  event: MidiEvent,
  devMapping: Device,
  state: WatchMidiState
) {
  if (event.type !== MidiEventType.NoteOff) {
    return;
  }

  const key = `${event.channel}:${event.note}`;
  const button = devMapping.buttons[key];
  if (button !== undefined && button.label === "Shift") {
    // shift key is inverted for some reason
    debug("Shift ON");
    state.shiftPressed = true;
    return;
  }
}

function handleControlChange(
  event: MidiEvent,
  devMapping: Device,
  bindings: Bindings,
  midishIn: Readable,
  state: WatchMidiState
) {
  if (event.type !== MidiEventType.ControlChange) {
    return;
  }

  // shift key disables dials. useful for changing
  // dial ranges without having skips in output
  if (state.shiftPressed) {
    return;
  }

  const key = `${event.channel}:${event.controller}`;
  const dial = devMapping.dials[key];
  if (dial) {
    debug(`[dial] `, dial.label, event.value);
    let pct = event.value / (dial.range[1] - dial.range[0]);
    if (state.ranges[dial.label] !== undefined) {
      const [start, end] = state.ranges[dial.label].range;
      pct = pct * (end - start) + start;
    }

    const binding = bindings[dial.label];
    if (binding !== undefined && binding.type === "passthrough") {
      const newCo = `out${binding.outChannel}`;
      const mappedPct = MAP_FUNCTIONS[binding.mapFunction ?? "IDENTITY"](pct);
      const mapped = Math.round(mappedPct * 16383);

      state.dials[dial.label] = mapped;
      if (!state.mutes[dial.label]) {
        const midishCmd = `oaddev {xctl ${newCo} ${binding.outController} ${mapped}}`;
        midishIn.push(midishCmd);
      }
    }
  }
}

type RangeStates = Record<string, { range: Range; idx: number }>;
type ButtonStates = Record<string, number>;
type MuteStates = Record<string, boolean>;
type DialStates = Record<string, number>;
type WatchMidiState = {
  shiftPressed: boolean;
  ranges: RangeStates;
  mutes: MuteStates;
  dials: DialStates;
  buttons: ButtonStates;
};

export async function watchMidiCommand(dev: string) {
  const [amidil] = await run("amidi --list-devices");
  const foundPort = amidil.split(/\r?\n/g).find((line) => line.includes(dev));

  const config = await readConfig("./config.json");
  log(`Loaded config file`);
  const BINDINGS = config.bindings;
  const BINDINGS_ENTRIES = Object.entries(BINDINGS);

  if (foundPort === undefined) {
    error(`Unable to locate device "${dev}"`);
    return;
  }

  const [matched, port] = foundPort.match(deviceRe) ?? [];
  if (!matched) {
    error(`Failed to extract port from device listing`);
    return;
  }

  const [watchMidiProm, stream] = watchMidi(port);
  const [midishProm, midishIn] = midish();

  const devMapping = apcKey25;

  // set up LED states on initialization
  amidiSend(HW_MIDI, defaultLEDStates(BINDINGS, devMapping));

  const state: WatchMidiState = {
    // midish "co" variable -- current output
    shiftPressed: false,
    buttons: {},
    mutes: {},
    dials: {},
    ranges: Object.fromEntries(
      BINDINGS_ENTRIES.map(([, val]) => {
        if (val.type === "range") {
          return [val.dial, { range: val.modes[0].range, idx: 0 }];
        } else {
          return undefined;
        }
      }).filter((v) => v !== undefined) as [
        string,
        { range: Range; idx: number }
      ][]
    ),
  };

  stream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;

    if (event.type === MidiEventType.NoteOn) {
      handleNoteOn(event, devMapping, BINDINGS, midishIn, state);
    } else if (event.type === MidiEventType.ControlChange) {
      handleControlChange(event, devMapping, BINDINGS, midishIn, state);
    } else if (event.type === MidiEventType.NoteOff) {
      handleNoteOff(event, devMapping, state);
    } else {
      log(event);
    }
  });

  try {
    await Promise.race([watchMidiProm, midishProm]);
  } catch (err) {
    error(`Problem ocurred with midi watch: exit code ${err}`);
  }
}
