import { Readable } from "stream";
import { ActionBinding, Config, readConfig } from "../config";
import { Button, Device, Dial, Range } from "../devices";
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
  destroyLink,
  ensureLink,
  PipewireDump,
  updateDump,
  watchPwDump,
} from "../pipewire";
import { PipewireItemType } from "../pipewire/types";
import {
  defaultLEDStates,
  run,
  buttonLEDBytes,
  connectMidiDevices,
  findDevicePort,
} from "../util";

const UPDATE_HOOK_TIMEOUT_MS = 300;
const QC35_NAME = "Bose QuietComfort 35";
const QC35_EQ_NAME = "LSP Parametric EQ x16 Stereo (QC35)";
const QC35_EQ_L = { node: QC35_EQ_NAME, port: "Output L" };
const QC35_EQ_R = { node: QC35_EQ_NAME, port: "Output R" };
const QC35_L = { node: QC35_NAME, port: "playback_FL" };
const QC35_R = { node: QC35_NAME, port: "playback_FR" };

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

const handlePwLinkError = (err: any) => {
  if (err instanceof Error) {
    if (
      !err.message.includes(
        "failed to unlink ports: No such file or directory"
      ) &&
      !err.message.includes("failed to link ports: File exists")
    ) {
      error(err);
      throw err;
    }
  }
};

const findButton = (event: MidiEvent) => {
  if (
    event.type === MidiEventType.NoteOn ||
    event.type === MidiEventType.NoteOff
  ) {
    return (b: Button) => b.channel === event.channel && b.note === event.note;
  }
};

const findDial = (event: MidiEvent) => {
  if (event.type === MidiEventType.ControlChange) {
    return (b: Dial) =>
      b.channel === event.channel && b.controller === event.controller;
  }
};

function handleBinding(
  binding: ActionBinding,
  config: Config,
  button: Button,
  midishIn: Readable,
  state: WatchMidiState
) {
  if (binding.type === "command") {
    run(binding.command);
    return;
  }

  if (binding.type === "midi") {
    const midishCmd = binding.events.map(midiEventToMidish).join("\n");
    midishIn.push(midishCmd);
    return;
  }

  if (binding.type === "pipewire::link") {
    ensureLink(binding.src, binding.dest, state.pipewire).catch(
      handlePwLinkError
    );
  }

  if (binding.type === "pipewire::unlink") {
    destroyLink(binding.src, binding.dest, state.pipewire).catch(
      handlePwLinkError
    );
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
      ledBytes = buttonLEDBytes(button, "GREEN", button.channel, button.note);
    } else {
      state.mutes[binding.dial] = true;
      ledBytes = buttonLEDBytes(button, "RED", button.channel, button.note);
    }

    midishIn.push(
      midiEventToMidish({
        type: MidiEventType.ControlChange,
        channel: dialBinding[1].outChannel,
        controller: dialBinding[1].outController,
        value: controlVal,
      })
    );

    amidiSend(config.virtMidi, [ledBytes]).catch(handleAmidiError);

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
      button.channel,
      button.note
    );

    amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
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
  const button = devMapping.buttons.find(
    (b) => b.channel === event.channel && b.note === event.note
  );

  if (button === undefined) {
    return;
  }

  if (button.label === "Shift") {
    debug("Shift ON");
    state.shiftPressed = true;
    return;
  }

  debug("[button pressed]", button.label);
  const binding = config.bindings[button.label];
  if (binding !== undefined) {
    if (binding.type === "passthrough") {
      // cannot passthrough note events (yet)
      return;
    }

    if (binding.type === "cycle") {
      if (state.buttons[button.label] === undefined) {
        state.buttons[button.label] = 1;
      } else {
        state.buttons[button.label] =
          (state.buttons[button.label] + 1) % binding.items.length;
      }

      const newBind = binding.items[state.buttons[button.label]];
      const data = buttonLEDBytes(
        button,
        newBind.color,
        event.channel,
        event.note
      );

      amidiSend(config.virtMidi, [data]).catch(handleAmidiError);

      handleBinding(newBind.bind, config, button, midishIn, state);
      return;
    }

    if (binding.type === "momentary") {
      const data = buttonLEDBytes(
        button,
        binding.onPress.color,
        event.channel,
        event.note
      );

      amidiSend(config.virtMidi, [data]).catch(handleAmidiError);

      binding.onPress.do.forEach((bind) => {
        handleBinding(bind, config, button, midishIn, state);
      });
      return;
    }

    handleBinding(binding, config, button, midishIn, state);
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

  const button = devMapping.buttons.find(findButton(event)!);
  if (button === undefined) {
    return;
  }

  if (button.label === "Shift") {
    debug("Shift OFF");
    state.shiftPressed = false;
    return;
  }

  const binding = config.bindings[button.label];
  if (binding !== undefined && binding.type === "momentary") {
    const color = binding.onRelease.color;
    const data = buttonLEDBytes(button, color, event.channel, event.note);
    amidiSend(config.virtMidi, [data]).catch(handleAmidiError);

    binding.onRelease.do.forEach((bind) => {
      handleBinding(bind, config, button, midishIn, state);
    });
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

  const dial = devMapping.dials.find(findDial(event)!);
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
  pipewire: PipewireDump;
};

export async function watchMidiCommand(configPath: string): Promise<0 | 1> {
  const config = await readConfig(configPath);
  log("Loaded config file");
  const dev = config.device;

  for (const [d1, d2] of config.connections) {
    await connectMidiDevices(d1, d2);
  }

  const devicePort = await findDevicePort(dev);
  if (!devicePort) {
    error("Failed to extract port from device listing");
    return 1;
  }

  const [watchMidiProm, stream] = watchMidi(devicePort);
  const [pipewireProm, pipewire] = watchPwDump();
  const [midishProm, midishIn] = midish();

  const devMapping = DEVICE_CONFS[dev];
  if (devMapping === undefined) {
    error(`No device config available for "${dev}"`);
    return 1;
  }

  // set up LED states on initialization
  amidiSend(config.virtMidi, defaultLEDStates(config.bindings, devMapping));

  const state: WatchMidiState = {
    shiftPressed: false,
    buttons: {},
    mutes: {},
    dials: {},
    pipewire: {
      items: {},
      links: {
        forward: {},
        reverse: {},
      },
    },
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

  let prevHadQC35 = false;

  let pipewireTimeout: NodeJS.Timeout | undefined = undefined;

  const rules = {
    onConnect: [
      {
        node: "Bose QuietComfort 35",
        do: {},
      },
    ],
  };

  pipewire.on("data", (data) => {
    updateDump(data.toString(), state.pipewire);

    if (pipewireTimeout !== undefined) {
      pipewireTimeout.refresh();
    } else {
      pipewireTimeout = setTimeout(() => {
        debug("running update hook");
        const hasQC35 = Object.values(state.pipewire.items).some(
          (item) =>
            item.type === PipewireItemType.PipeWireInterfaceNode &&
            item.info?.props?.["node.description"] === QC35_NAME
        );

        if (!prevHadQC35 && hasQC35) {
          Promise.all([
            ensureLink(QC35_EQ_L, QC35_L, state.pipewire),
            ensureLink(QC35_EQ_R, QC35_R, state.pipewire),
          ]).catch(handlePwLinkError);
        }

        prevHadQC35 = hasQC35;
        pipewireTimeout = undefined;
      }, UPDATE_HOOK_TIMEOUT_MS);
    }
  });

  stream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;
    debug("[midi]", event);

    switch (event.type) {
      case MidiEventType.NoteOn:
        handleNoteOn(event, devMapping, config, midishIn, state);
        break;
      case MidiEventType.NoteOff:
        handleNoteOff(event, devMapping, config, midishIn, state);
        break;
      case MidiEventType.ControlChange:
        handleControlChange(event, devMapping, config, midishIn, state);
        break;
      default:
        log(event);
    }
  });

  try {
    await Promise.race([watchMidiProm, pipewireProm, midishProm]);
    return 0;
  } catch (err) {
    error(`Problem ocurred with midi watch: exit code ${err}`);
    return 1;
  }
}
