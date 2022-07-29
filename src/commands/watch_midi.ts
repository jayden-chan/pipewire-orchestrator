import { Readable } from "stream";
import { Bindings, DialRange, readConfig } from "../config";
import { Button, Device, Range } from "../devices";
import { apcKey25 } from "../devices/apcKey25";
import { debug, error, log, warn } from "../logger";
import {
  amidiSend,
  ByteTriplet,
  MidiEvent,
  midiEventToNumber,
  MidiEventType,
  watchMidi,
} from "../midi";
import { midish } from "../midi/midish";
import { run } from "../util";

const deviceRe = /^IO\s+([a-zA-Z0-9:,]+)\s+(.*?)$/;

// TODO: stop hard-coding this later
const HW_MIDI = "hw:5,1";

const MAP_FUNCTIONS = {
  IDENTITY: (input: any) => input,
  SQUARED: (input: number) => input * input,
  SQRT: (input: number) => Math.sqrt(input),
};

function setRangeLed(
  button: Button,
  mode: DialRange,
  channel: number,
  note: number
): ByteTriplet | undefined {
  if (button.ledStates !== undefined) {
    const requestedColor = mode.color;
    const ledState = Object.entries(button.ledStates).find(([color]) => {
      return color === requestedColor;
    });

    debug(`[setRangeLed]`, button, mode, channel, note);

    if (ledState === undefined) {
      warn(
        `Button ${button.label} doesn't support requested color ${requestedColor}`
      );
    } else {
      return {
        b1: (midiEventToNumber(MidiEventType.NoteOff) << 4) | channel,
        b2: note,
        b3: ledState[1],
      };
    }
  }
}

function handleNoteOn(
  event: MidiEvent,
  devMapping: Device,
  bindings: Bindings,
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
  const binding = bindings[button.label];
  if (binding !== undefined) {
    if (binding.type === "command") {
      run(binding.command);
    } else if (binding.type === "range") {
      const newIdx =
        (state.ranges[binding.dial].idx + 1) % binding.modes.length;
      const newMode = binding.modes[newIdx];
      state.ranges[binding.dial] = {
        range: newMode.range,
        idx: newIdx,
      };

      const data = setRangeLed(button, newMode, event.channel, event.note);

      if (data !== undefined) {
        amidiSend(HW_MIDI, [data]);
      }
    }
  } else {
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
  // dial ranges without having skips output
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
      let midishCmd = `oaddev {xctl ${newCo} ${binding.outController} ${mapped}}`;

      // update the current output in midish if necessary
      if (newCo !== state.co) {
        midishCmd = `co ${newCo}\n${midishCmd}`;
        state.co = newCo;
      }
      debug(`[midish] [cmd]: ${midishCmd.replace(/\n/g, "<CR>")}`);
      midishIn.push(midishCmd);
    }
  }
}

type RangeStates = Record<string, { range: Range; idx: number }>;
type ButtonStates = Record<string, number>;
type WatchMidiState = {
  co: string;
  shiftPressed: boolean;
  ranges: RangeStates;
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
  amidiSend(
    HW_MIDI,
    BINDINGS_ENTRIES.map(([key, binding]) => {
      const devKey = Object.entries(devMapping.buttons).find(
        ([, b]) => b.label === key
      );

      if (devKey === undefined) {
        return undefined;
      }

      if (binding.type === "range") {
        const mode = binding.modes[0];
        const [channel, note] = devKey[0].split(":").map((n) => Number(n));
        return setRangeLed(devKey[1], mode, channel, note);
      }

      if (binding.type === "command") {
        const onState = Object.entries(devKey[1].ledStates ?? {}).find(
          ([state]) => state === "ON"
        );

        if (onState !== undefined) {
          const [channel, note] = devKey[0].split(":").map((n) => Number(n));
          return {
            b1: (midiEventToNumber(MidiEventType.NoteOff) << 4) | channel,
            b2: note,
            b3: onState[1],
          };
        }
      }
    }).filter((f) => f !== undefined) as ByteTriplet[]
  );

  const state: WatchMidiState = {
    // midish "co" variable -- current output
    co: "out0",
    shiftPressed: false,
    buttons: {},
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
      handleNoteOn(event, devMapping, BINDINGS, state);
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
