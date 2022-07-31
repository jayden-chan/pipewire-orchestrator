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
  audioClients,
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
  run,
} from "../util";

const UPDATE_HOOK_TIMEOUT_MS = 150;

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

function handleBinding(
  binding: ActionBinding,
  config: Config,
  midishIn: Readable,
  state: WatchMidiState,
  button?: Button
) {
  if (binding.type === "command") {
    run(binding.command).catch((err) => {
      error(`[command]`, err);
    });
    return;
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

  if (binding.type === "pipewire::select_link") {
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

    debug("[select_link]", sources);
    debug("[select_link]", mixerChannels);

    run(
      `echo "${Object.keys(sources).join(
        "\n"
      )}" | rofi -dmenu -i -p "select source:" -theme links`
    )
      .then(([stdout1]) => {
        const sourceId = sources[stdout1.trim()];
        run(
          `echo "${Object.keys(mixerChannels).join(
            "\n"
          )}" | rofi -dmenu -i -p "select mixer channel:" -theme links`
        )
          .then(([stdout2]) => {
            const mixerChannel = mixerChannels[stdout2.trim()];
            const sourceNodeId = sourceId.node.id;

            sourceId.ports.forEach((port) => {
              const sourcePortId = port.id;
              const destPort =
                port.info?.props?.["audio.channel"] === "FL"
                  ? mixerChannel.ports[0]
                  : mixerChannel.ports[1];

              const sourceName = port.info?.props?.["port.alias"];
              const destName = destPort.info?.props?.["port.alias"];

              const command = `pw-link "${sourceName}" "${destName}"`;
              log(`[command] ${command}`);
              run(command).catch(handlePwLinkError);

              const key = `${sourceNodeId}:${sourcePortId}`;
              const srcLinks = state.pipewire.state.links.forward[key];
              if (srcLinks !== undefined) {
                // remove any links that aren't the exclusive one specified
                srcLinks.links.forEach(([, dPort]) => {
                  if (dPort.id !== destPort.id) {
                    const dName = dPort.info?.props?.["port.alias"];
                    const command = `pw-link -d "${sourceName}" "${dName}"`;
                    log(`[command] ${command}`);
                    run(command).catch(handlePwLinkError);
                  }
                });
              }
            });
          })
          .catch((_) => {});
      })
      .catch((_) => {});
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
      ledBytes =
        button && buttonLEDBytes(button, "GREEN", button.channel, button.note);
    } else {
      state.mutes[binding.dial] = true;
      ledBytes =
        button && buttonLEDBytes(button, "RED", button.channel, button.note);
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

    const data =
      button &&
      buttonLEDBytes(button, newMode.color, button.channel, button.note);

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
      handleBinding(newBind.bind, config, midishIn, state, button);
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
        handleBinding(bind, config, midishIn, state, button);
      });
      return;
    }

    handleBinding(binding, config, midishIn, state, button);
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
      handleBinding(bind, config, midishIn, state, button);
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
  pipewire: {
    state: PipewireDump;
    prevDevices: Record<string, boolean>;
  };
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
