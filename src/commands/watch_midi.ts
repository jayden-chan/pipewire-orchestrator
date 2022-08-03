import { Readable } from "stream";
import {
  ActionBinding,
  readConfig,
  RuntimeConfig,
  ButtonBindAction,
} from "../config";
import { Button, Device, Dial, Range } from "../devices";
import { apcKey25 } from "../devices/apcKey25";
import { handleAmidiError, handlePwLinkError } from "../errors";
import { debug, error, log } from "../logger";
import {
  amidiSend,
  ByteTriplet,
  MidiEvent,
  MidiEventControlChange,
  MidiEventNoteOff,
  MidiEventNoteOn,
  MidiEventType,
  watchMidi,
} from "../midi";
import { midiEventToMidish, midish } from "../midi/midish";
import {
  audioClients,
  connectAppToMixer,
  destroyLink,
  ensureLink,
  exclusiveLink,
  findPwNode,
  mixerPorts,
  NodeWithPorts,
  PipewireDump,
  updateDump,
  watchPwDump,
} from "../pipewire";
import {
  buttonLEDBytes,
  connectMidiDevices,
  defaultLEDStates,
  findDevicePort,
  manifestDialValue,
  run,
} from "../util";

type RangeStates = Record<string, { range: Range; idx: number }>;
export type WatchMidiState = {
  shiftPressed: boolean;
  rofiOpen: boolean;
  ranges: RangeStates;
  mutes: Record<string, boolean>;
  dials: Record<string, number>;
  buttons: Record<string, number>;
  buttonColors: Record<string, string>;
  pipewire: {
    state: PipewireDump;
    timeout: NodeJS.Timeout | undefined;
    prevDevices: Record<string, boolean>;
  };
};

const UPDATE_HOOK_TIMEOUT_MS = 150;
const DEVICE_CONFS: Record<string, Device> = {
  "APC Key 25 MIDI": apcKey25,
};

const findButton = (event: MidiEventNoteOn | MidiEventNoteOff) => {
  return (b: Button) => b.channel === event.channel && b.note === event.note;
};

const findDial = (event: MidiEventControlChange) => {
  return (b: Dial) =>
    b.channel === event.channel && b.controller === event.controller;
};

async function doActionBinding(
  binding: ActionBinding,
  config: RuntimeConfig,
  midishIn: Readable,
  state: WatchMidiState,
  button?: Button
): Promise<void> {
  switch (binding.type) {
    case "command":
      return run(binding.command)
        .then(() => Promise.resolve())
        .catch((err) => {
          error("[run-command]", err);
        });
    case "midi":
      midishIn.push(binding.events.map(midiEventToMidish).join("\n"));
      return;
    case "pipewire::link":
      return ensureLink(binding.src, binding.dest, state.pipewire.state).catch(
        handlePwLinkError
      );
    case "pipewire::unlink":
      return destroyLink(binding.src, binding.dest, state.pipewire.state).catch(
        handlePwLinkError
      );
    case "pipewire::exclusive_link":
      return exclusiveLink(
        binding.src,
        binding.dest,
        state.pipewire.state
      ).catch(handlePwLinkError);
  }

  if (binding.type === "mute") {
    let controlVal = 0;
    let ledBytes: ByteTriplet | undefined = undefined;

    if (state.mutes[binding.dial]) {
      state.mutes[binding.dial] = false;
      controlVal = state.dials[binding.dial] ?? 0;
      ledBytes =
        button &&
        buttonLEDBytes(button, "GREEN", button.channel, button.note, state);
    } else {
      state.mutes[binding.dial] = true;
      controlVal = 0;
      ledBytes =
        button &&
        buttonLEDBytes(button, "RED", button.channel, button.note, state);
    }

    manifestDialValue(binding.dial, controlVal, config, state, midishIn);
    return amidiSend(config.outputMidi, [ledBytes]).catch(handleAmidiError);
  }

  if (binding.type == "mixer::select") {
    let resetLED = () => {};
    if (button !== undefined) {
      const initialButtonColor = state.buttonColors[button.label];

      const data = buttonLEDBytes(
        button,
        binding.pendingColor,
        button.channel,
        button.note,
        state
      );
      amidiSend(config.outputMidi, [data]).catch(handleAmidiError);

      resetLED = () => {
        if (button !== undefined) {
          const data = buttonLEDBytes(
            button,
            initialButtonColor,
            button.channel,
            button.note,
            state
          );
          amidiSend(config.outputMidi, [data]).catch(handleAmidiError);
        }
      };
    }

    const mixerChannels = mixerPorts(state.pipewire.state);
    if (mixerChannels === undefined) {
      return;
    }

    const sources: Record<string, NodeWithPorts> = Object.fromEntries(
      audioClients(state.pipewire.state).map((item) => [
        item.node.info?.props?.["application.name"],
        item,
      ])
    );

    state.rofiOpen = true;
    const sourcesString = Object.keys(sources).join("\n");
    const cmd = `echo "${sourcesString}" | rofi -dmenu -i -p "select source:" -theme links`;
    return run(cmd)
      .then(([stdout]) => {
        const source = sources[stdout.trim()];
        const channel = mixerChannels[`Mixer Channel ${binding.channel}`];
        connectAppToMixer(source, channel, state.pipewire.state).then(() =>
          resetLED()
        );
      })
      .catch((_) => resetLED())
      .finally(() => (state.rofiOpen = false));
  }

  if (binding.type === "range") {
    if (state.ranges[binding.dial] === undefined) {
      const initialMode = binding.modes[0];
      state.ranges[binding.dial] = {
        range: initialMode.range,
        idx: 0,
      };
    }

    const newIdx = (state.ranges[binding.dial].idx + 1) % binding.modes.length;
    const newMode = binding.modes[newIdx];
    state.ranges[binding.dial] = {
      range: newMode.range,
      idx: newIdx,
    };

    // update the dial value immediately so we don't get a jump
    // in volume the next time the dial is moved
    manifestDialValue(
      binding.dial,
      state.dials[binding.dial] ?? 0,
      config,
      state,
      midishIn
    );

    const data =
      button &&
      buttonLEDBytes(button, newMode.color, button.channel, button.note, state);

    return amidiSend(config.outputMidi, [data]).catch(handleAmidiError);
  }
}

async function handleNoteOn(
  event: MidiEventNoteOn,
  config: RuntimeConfig,
  midishIn: Readable,
  state: WatchMidiState
): Promise<void> {
  if (event.channel === config.device.keys.channel) {
    debug(`Key ON ${event.note} velocity ${event.velocity}`);
    return;
  }

  const button = config.device.buttons.find(
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
  if (
    binding === undefined ||
    binding.type !== "button" ||
    binding.onPress === undefined
  ) {
    return;
  }

  if (state.shiftPressed && binding.onShiftPress !== undefined) {
    amidiSend(config.outputMidi, [
      buttonLEDBytes(
        button,
        binding.onShiftPress.color,
        button.channel,
        button.note,
        state
      ),
    ]);

    return Promise.all(
      binding.onShiftPress.actions.map((bind) =>
        handleButtonBinding(bind, button, event, state, config, midishIn)
      )
    ).then(() => Promise.resolve());
  }

  if (!state.shiftPressed && binding.onPress !== undefined) {
    amidiSend(config.outputMidi, [
      buttonLEDBytes(
        button,
        binding.onPress.color,
        button.channel,
        button.note,
        state
      ),
    ]);

    return Promise.all(
      binding.onPress.actions.map((bind) =>
        handleButtonBinding(bind, button, event, state, config, midishIn)
      )
    ).then(() => Promise.resolve());
  }
}

async function handleButtonBinding(
  binding: ButtonBindAction,
  button: Button,
  event: MidiEventNoteOn | MidiEventNoteOff,
  state: WatchMidiState,
  config: RuntimeConfig,
  midishIn: Readable
) {
  if (binding.type === "cancel") {
    if (state.rofiOpen) {
      run("xdotool key Escape").catch((err) => error(err));
    } else if (binding.alt !== undefined) {
      return doActionBinding(binding.alt, config, midishIn, state, button);
    }
    return;
  }

  if (binding.type === "command") {
    if (state.buttons[button.label] === undefined) {
      const runningState = Object.entries(button.ledStates ?? {}).find(
        // TODO: stop hard coding this
        ([state]) => state === "AMBER"
      );

      const data = buttonLEDBytes(
        button,
        (runningState ?? ["OFF"])[0],
        event.channel,
        event.note,
        state
      );

      amidiSend(config.outputMidi, [data]).catch(handleAmidiError);
    }

    const timestamp = new Date().valueOf();
    state.buttons[button.label] = timestamp;

    return doActionBinding(binding, config, midishIn, state, button).then(
      () => {
        if (state.buttons[button.label] !== timestamp) {
          return;
        }

        delete state.buttons[button.label];

        setTimeout(
          () => {
            const onState = Object.entries(button.ledStates ?? {}).find(
              ([state]) => state === "ON" || state === "GREEN"
            );

            if (onState !== undefined) {
              const data = buttonLEDBytes(
                button,
                onState[0],
                event.channel,
                event.note,
                state
              );
              amidiSend(config.outputMidi, [data]).catch(handleAmidiError);
            }
          },
          new Date().valueOf() - timestamp < 150 ? 150 : 0
        );
      }
    );
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
      event.note,
      state
    );

    amidiSend(config.outputMidi, [data]).catch(handleAmidiError);
    return Promise.all(
      newBind.actions.map((bind) => {
        return doActionBinding(bind, config, midishIn, state, button);
      })
    ).then(() => Promise.resolve());
  }

  return doActionBinding(binding, config, midishIn, state, button);
}

function handleNoteOff(
  event: MidiEventNoteOff,
  config: RuntimeConfig,
  midishIn: Readable,
  state: WatchMidiState
) {
  if (event.channel === config.device.keys.channel) {
    debug(`Key OFF ${event.note} velocity ${event.velocity}`);
    return;
  }

  const button = config.device.buttons.find(findButton(event)!);
  if (button === undefined) {
    return;
  }

  if (button.label === "Shift") {
    debug("Shift OFF");
    state.shiftPressed = false;
    return;
  }

  const binding = config.bindings[button.label];
  if (
    binding === undefined ||
    binding.type !== "button" ||
    binding.onRelease === undefined
  ) {
    return;
  }

  amidiSend(config.outputMidi, [
    buttonLEDBytes(
      button,
      binding.onRelease.color,
      button.channel,
      button.note,
      state
    ),
  ]);

  return Promise.all(
    binding.onRelease.actions.map((bind) =>
      handleButtonBinding(bind, button, event, state, config, midishIn)
    )
  ).then(() => Promise.resolve());
}

function handleControlChange(
  event: MidiEventControlChange,
  config: RuntimeConfig,
  midishIn: Readable,
  state: WatchMidiState
) {
  // shift key disables dials. useful for changing
  // dial ranges without having skips in output
  if (state.shiftPressed) {
    return;
  }

  const dial = config.device.dials.find(findDial(event)!);
  if (dial !== undefined) {
    debug(`[dial] `, dial.label, event.value);
    manifestDialValue(dial.label, event.value, config, state, midishIn);
    state.dials[dial.label] = event.value;
  }
}

export async function watchMidiCommand(configPath: string): Promise<0 | 1> {
  const rawConfig = await readConfig(configPath);
  log("Loaded config file");

  const dev = rawConfig.device;
  const devicePort = await findDevicePort(dev);
  if (!devicePort) {
    error("Failed to extract port from device listing");
    return 1;
  }

  for (const [d1, d2] of rawConfig.connections) {
    await connectMidiDevices(d1, d2);
  }

  const [watchMidiPromise, stream] = watchMidi(devicePort);
  const [pipewirePromise, pipewire] = watchPwDump();
  const [midishPromise, midishIn] = midish();

  const device = DEVICE_CONFS[dev];
  if (device === undefined) {
    error(`No device config available for "${dev}"`);
    return 1;
  }

  const config: RuntimeConfig = { ...rawConfig, device };
  const state: WatchMidiState = {
    shiftPressed: false,
    rofiOpen: false,
    buttons: {},
    buttonColors: {},
    mutes: {},
    dials: {},
    pipewire: {
      timeout: undefined,
      prevDevices: Object.fromEntries([
        ...config.pipewire.rules.onConnect.map((rule) => [rule.node, false]),
        ...config.pipewire.rules.onDisconnect.map((rule) => [rule.node, true]),
      ]),
      state: {
        items: {},
        links: {
          forward: {},
          reverse: {},
        },
      },
    },
    ranges: {},
  };

  // set up LED states on initialization
  amidiSend(
    config.outputMidi,
    defaultLEDStates(config.bindings, device, state)
  );

  pipewire.on("data", (data) => {
    updateDump(data.toString(), state.pipewire.state);

    if (state.pipewire.timeout !== undefined) {
      state.pipewire.timeout.refresh();
      return;
    }

    state.pipewire.timeout = setTimeout(() => {
      const pwItems = Object.values(state.pipewire.state.items);
      config.pipewire.rules.onConnect.forEach((rule) => {
        if (state.pipewire.prevDevices[rule.node] === true) return;

        const hasDevice = pwItems.some(findPwNode(rule.node));

        if (hasDevice) {
          rule.do.forEach((binding) => {
            doActionBinding(binding, config, midishIn, state);
          });
        }
      });

      config.pipewire.rules.onDisconnect.forEach((rule) => {
        if (state.pipewire.prevDevices[rule.node] === false) return;

        const hasDevice = pwItems.some(findPwNode(rule.node));

        if (!hasDevice) {
          rule.do.forEach((binding) => {
            doActionBinding(binding, config, midishIn, state);
          });
        }
      });

      Object.keys(state.pipewire.prevDevices).forEach((device) => {
        state.pipewire.prevDevices[device] = pwItems.some(findPwNode(device));
      });
    }, UPDATE_HOOK_TIMEOUT_MS);
  });

  stream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;
    debug("[midi]", event);

    switch (event.type) {
      case MidiEventType.NoteOn:
        handleNoteOn(event, config, midishIn, state);
        break;
      case MidiEventType.NoteOff:
        handleNoteOff(event, config, midishIn, state);
        break;
      case MidiEventType.ControlChange:
        handleControlChange(event, config, midishIn, state);
        break;
      default:
        log(event);
    }
  });

  try {
    await Promise.race([watchMidiPromise, pipewirePromise, midishPromise]);
    return 0;
  } catch (err) {
    error(`Problem ocurred with midi watch: exit code ${err}`);
    return 1;
  }
}
