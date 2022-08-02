import { Readable } from "stream";
import { ActionBinding, readConfig, RuntimeConfig } from "../config";
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

const UPDATE_HOOK_TIMEOUT_MS = 150;
const DEVICE_CONFS: Record<string, Device> = {
  "APC Key 25 MIDI": apcKey25,
};

const handleAmidiError = (err: any) =>
  error("failed to send midi to amidi:", err);

export const handlePwLinkError = (err: any) => {
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

async function handleBinding(
  binding: ActionBinding,
  config: RuntimeConfig,
  midishIn: Readable,
  state: WatchMidiState,
  button?: Button
): Promise<void> {
  if (binding.type === "command") {
    return run(binding.command).then(() => Promise.resolve());
  }

  if (binding.type === "midi") {
    const midishCmd = binding.events.map(midiEventToMidish).join("\n");
    midishIn.push(midishCmd);
    return;
  }

  if (binding.type === "pipewire::link") {
    ensureLink(binding.src, binding.dest, state.pipewire.state).catch(
      handlePwLinkError
    );
    return;
  }

  if (binding.type === "pipewire::unlink") {
    destroyLink(binding.src, binding.dest, state.pipewire.state).catch(
      handlePwLinkError
    );
    return;
  }

  if (binding.type === "pipewire::exclusive_link") {
    exclusiveLink(binding.src, binding.dest, state.pipewire.state).catch(
      handlePwLinkError
    );
    return;
  }

  if (binding.type === "mute") {
    let controlVal = 0;
    let ledBytes: ByteTriplet | undefined = undefined;

    if (state.mutes[binding.dial]) {
      state.mutes[binding.dial] = false;
      controlVal = state.dials[binding.dial] ?? 0;
      ledBytes =
        button && buttonLEDBytes(button, "GREEN", button.channel, button.note);
    } else {
      state.mutes[binding.dial] = true;
      controlVal = 0;
      ledBytes =
        button && buttonLEDBytes(button, "RED", button.channel, button.note);
    }

    manifestDialValue(binding.dial, controlVal, config, state, midishIn);
    return amidiSend(config.virtMidi, [ledBytes]).catch(handleAmidiError);
  }

  if (binding.type === "range") {
    if (state.shiftPressed) {
      const data =
        button &&
        // TODO: stop hard coding this
        buttonLEDBytes(button, "AMBER_FLASHING", button.channel, button.note);

      amidiSend(config.virtMidi, [data]).catch(handleAmidiError);

      const sources: Record<string, NodeWithPorts> = Object.fromEntries(
        audioClients(state.pipewire.state).map((item) => [
          item.node.info?.props?.["application.name"],
          item,
        ])
      );

      const mixerChannels = mixerPorts(state.pipewire.state);
      if (mixerChannels === undefined) {
        return;
      }

      const resetLED = () => {
        if (button !== undefined) {
          const data = buttonLEDBytes(
            button,
            binding.modes[0].color,
            button.channel,
            button.note
          );
          amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
        }
      };

      state.rofiOpen = true;
      run(
        `echo "${Object.keys(sources).join(
          "\n"
        )}" | rofi -dmenu -i -p "select source:" -theme links`
      )
        .then(([stdout]) => {
          const source = sources[stdout.trim()];
          const mixerChannel = Number(
            binding.dial.slice(binding.dial.indexOf("Dial ") + 5)
          );
          const channel = mixerChannels[`Mixer Channel ${mixerChannel}`];
          connectAppToMixer(source, channel, state.pipewire.state).then(() =>
            resetLED()
          );
        })
        .catch((_) => resetLED())
        .finally(() => (state.rofiOpen = false));
    } else {
      const newIdx =
        (state.ranges[binding.dial].idx + 1) % binding.modes.length;
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
        buttonLEDBytes(button, newMode.color, button.channel, button.note);

      amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
    }
  }
}

async function handleNoteOn(
  event: MidiEvent,
  config: RuntimeConfig,
  midishIn: Readable,
  state: WatchMidiState
): Promise<void> {
  if (event.type !== MidiEventType.NoteOn) {
    return;
  }

  if (event.channel === config.device.keys.channel) {
    debug(`Key ON ${event.note} velocity ${event.velocity}`);
    return;
  }

  const key = `${event.channel}:${event.note}`;
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
  if (binding !== undefined) {
    if (binding.type === "passthrough") {
      // cannot passthrough note events (yet)
      return;
    }

    if (binding.type === "cancel") {
      if (state.rofiOpen) {
        run("xdotool key Escape").catch((err) => error(err));
      } else if (binding.alt !== undefined) {
        return handleBinding(binding.alt, config, midishIn, state, button);
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
          event.note
        );

        amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
      }

      const timestamp = new Date().valueOf();
      state.buttons[button.label] = timestamp;

      return handleBinding(binding, config, midishIn, state, button).then(
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
                  event.note
                );
                amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
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
        event.note
      );

      amidiSend(config.virtMidi, [data]).catch(handleAmidiError);
      return Promise.all(
        newBind.actions.map((bind) => {
          return handleBinding(bind, config, midishIn, state, button);
        })
      ).then(() => Promise.resolve());
    }

    if (binding.type === "momentary") {
      const data = buttonLEDBytes(
        button,
        binding.onPress.color,
        event.channel,
        event.note
      );

      amidiSend(config.virtMidi, [data]).catch(handleAmidiError);

      return Promise.all(
        binding.onPress.do.map((bind) => {
          return handleBinding(bind, config, midishIn, state, button);
        })
      ).then(() => Promise.resolve());
    }

    return handleBinding(binding, config, midishIn, state, button);
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
    return amidiSend(config.virtMidi, [data]);
  }
}

function handleNoteOff(
  event: MidiEvent,
  config: RuntimeConfig,
  midishIn: Readable,
  state: WatchMidiState
) {
  if (event.type !== MidiEventType.NoteOff) {
    return;
  }

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
  if (binding !== undefined && binding.type === "momentary") {
    const color = binding.onRelease.color;
    const data = buttonLEDBytes(button, color, event.channel, event.note);
    amidiSend(config.virtMidi, [data]).catch(handleAmidiError);

    binding.onRelease.do.forEach((bind) => {
      handleBinding(bind, config, midishIn, state, button);
    });
  }
}

function handleControlChange(
  event: MidiEvent,
  config: RuntimeConfig,
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

  const dial = config.device.dials.find(findDial(event)!);
  if (dial !== undefined) {
    debug(`[dial] `, dial.label, event.value);
    manifestDialValue(dial.label, event.value, config, state, midishIn);
    state.dials[dial.label] = event.value;
  }
}

type RangeStates = Record<string, { range: Range; idx: number }>;
type ButtonStates = Record<string, number>;
type MuteStates = Record<string, boolean>;
type DialStates = Record<string, number>;
export type WatchMidiState = {
  shiftPressed: boolean;
  rofiOpen: boolean;
  ranges: RangeStates;
  mutes: MuteStates;
  dials: DialStates;
  buttons: ButtonStates;
  pipewire: {
    state: PipewireDump;
    prevDevices: Record<string, boolean>;
  };
};

export async function watchMidiCommand(configPath: string): Promise<0 | 1> {
  const rawConfig = await readConfig(configPath);
  log("Loaded config file");
  const dev = rawConfig.device;

  for (const [d1, d2] of rawConfig.connections) {
    await connectMidiDevices(d1, d2);
  }

  const devicePort = await findDevicePort(dev);
  if (!devicePort) {
    error("Failed to extract port from device listing");
    return 1;
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

  // set up LED states on initialization
  amidiSend(config.virtMidi, defaultLEDStates(config.bindings, device));

  const state: WatchMidiState = {
    shiftPressed: false,
    rofiOpen: false,
    buttons: {},
    mutes: {},
    dials: {},
    pipewire: {
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

  let pipewireTimeout: NodeJS.Timeout | undefined = undefined;

  pipewire.on("data", (data) => {
    updateDump(data.toString(), state.pipewire.state);

    if (pipewireTimeout !== undefined) {
      pipewireTimeout.refresh();
    } else {
      pipewireTimeout = setTimeout(() => {
        const pwItems = Object.values(state.pipewire.state.items);
        config.pipewire.rules.onConnect.forEach((rule) => {
          if (state.pipewire.prevDevices[rule.node] === true) return;

          const hasDevice = pwItems.some(findPwNode(rule.node));

          if (hasDevice) {
            rule.do.forEach((binding) => {
              handleBinding(binding, config, midishIn, state);
            });
          }
        });

        config.pipewire.rules.onDisconnect.forEach((rule) => {
          if (state.pipewire.prevDevices[rule.node] === false) return;

          const hasDevice = pwItems.some(findPwNode(rule.node));

          if (!hasDevice) {
            rule.do.forEach((binding) => {
              handleBinding(binding, config, midishIn, state);
            });
          }
        });

        Object.keys(state.pipewire.prevDevices).forEach((device) => {
          state.pipewire.prevDevices[device] = pwItems.some(findPwNode(device));
        });
      }, UPDATE_HOOK_TIMEOUT_MS);
    }
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
