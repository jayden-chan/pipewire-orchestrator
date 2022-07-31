import { Readable } from "stream";
import { Binding, Config, readConfig } from "../config";
import { Button, Device, Range } from "../devices";
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
import {
  defaultLEDStates,
  run,
  buttonLEDBytes,
  connectMidiDevices,
  findDevicePort,
} from "../util";

const MAP_FUNCTIONS = {
  IDENTITY: (input: any) => input,
  SQUARED: (input: number) => input * input,
  SQRT: (input: number) => Math.sqrt(input),
};

const DEVICE_CONFS: Record<string, Device> = {
  "APC Key 25 MIDI": apcKey25,
};

const handleAmidiError = (err: any) =>
  error("failed to send midi to amidi:", err);

function handleBinding(
  event: MidiEvent,
  binding: Binding,
  config: Config,
  button: Button,
  midishIn: Readable,
  state: WatchMidiState
) {
  if (
    event.type !== MidiEventType.NoteOn &&
    event.type !== MidiEventType.NoteOff
  ) {
    return;
  }

  if (binding.type === "command") {
    run(binding.command);
    return;
  }

  if (binding.type === "midi") {
    const midishCmd = binding.events.map(midiEventToMidish).join("\n");
    midishIn.push(midishCmd);
    return;
  }

  if (binding.type === "mute") {
    const bDial = binding.dial;
    const dialBinding = Object.entries(config.bindings).find(
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
      const stateVal = state.dials[binding.dial];
      controlVal = stateVal !== undefined ? stateVal : 0;
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
      amidiSend(config.virtMidi, [ledBytes]).catch(handleAmidiError);
    }

    return;
  }

  if (binding.type === "range") {
    const newIdx = (state.ranges[binding.dial].idx + 1) % binding.modes.length;
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
      amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
    }
  }
}

function handleNoteOn(
  event: MidiEvent,
  devMapping: Device,
  config: Config,
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

  debug("[button pressed]", button.label);
  let binding = config.bindings[button.label];
  if (binding !== undefined) {
    let setColor: string | undefined = undefined;
    if (binding.type === "cycle") {
      if (state.buttons[button.label] === undefined) {
        state.buttons[button.label] = 1;
      } else {
        state.buttons[button.label] =
          (state.buttons[button.label] + 1) % binding.items.length;
      }

      const newBind = binding.items[state.buttons[button.label]];
      setColor = newBind.color;

      binding = newBind.bind;
    }

    if (binding.type === "momentary") {
      setColor = binding.onPress.color;
      binding = binding.onPress.bind;
    }

    if (setColor !== undefined) {
      const data = buttonLEDBytes(button, setColor, event.channel, event.note);
      if (data !== undefined) {
        amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
      }
    }

    handleBinding(event, binding, config, button, midishIn, state);
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
    amidiSend(config.virtMidi, [data]);
  }
}

function handleNoteOff(
  event: MidiEvent,
  devMapping: Device,
  config: Config,
  midishIn: Readable,
  state: WatchMidiState
) {
  if (event.type !== MidiEventType.NoteOff) {
    return;
  }

  const key = `${event.channel}:${event.note}`;
  const button = devMapping.buttons[key];
  if (button === undefined) {
    return;
  }

  if (button.label === "Shift") {
    // shift key is inverted for some reason
    debug("Shift ON");
    state.shiftPressed = true;
    return;
  }

  let binding = config.bindings[button.label];
  if (binding !== undefined && binding.type === "momentary") {
    let color = binding.onRelease.color;
    if (color !== undefined) {
      const data = buttonLEDBytes(button, color, event.channel, event.note);
      if (data !== undefined) {
        amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
      }
    }

    binding = binding.onRelease.bind;
    handleBinding(event, binding, config, button, midishIn, state);
  }
}

function handleControlChange(
  event: MidiEvent,
  devMapping: Device,
  config: Config,
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

    const binding = config.bindings[dial.label];
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

export async function watchMidiCommand(configPath: string) {
  const config = await readConfig(configPath);
  log("Loaded config file");
  const dev = config.device;

  for (const [d1, d2] of config.connections) {
    await connectMidiDevices(d1, d2);
  }

  const devicePort = await findDevicePort(dev);
  if (!devicePort) {
    error("Failed to extract port from device listing");
    return;
  }

  const [watchMidiProm, stream] = watchMidi(devicePort);
  const [midishProm, midishIn] = midish();

  const devMapping = DEVICE_CONFS[dev];
  if (devMapping === undefined) {
    error(`No device config available for "${dev}"`);
    return;
  }

  // set up LED states on initialization
  amidiSend(config.virtMidi, defaultLEDStates(config.bindings, devMapping));

  const state: WatchMidiState = {
    shiftPressed: false,
    buttons: {},
    mutes: {},
    dials: {},
    ranges: Object.fromEntries(
      Object.entries(config.bindings)
        .map(([, val]) =>
          val.type === "range"
            ? [val.dial, { range: val.modes[0].range, idx: 0 }]
            : undefined
        )
        .filter((v) => v !== undefined) as [
        string,
        { range: Range; idx: number }
      ][]
    ),
  };

  stream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;
    debug("[midi]", event);

    if (event.type === MidiEventType.NoteOn) {
      handleNoteOn(event, devMapping, config, midishIn, state);
    } else if (event.type === MidiEventType.ControlChange) {
      handleControlChange(event, devMapping, config, midishIn, state);
    } else if (event.type === MidiEventType.NoteOff) {
      handleNoteOff(event, devMapping, config, midishIn, state);
    } else {
      log(event);
    }
  });

  try {
    await Promise.race([watchMidiProm, midishProm]);
  } catch (err) {
    error(`Problem ocurred with midi watch: exit code ${err}`);
    process.exit(1);
  }
}
