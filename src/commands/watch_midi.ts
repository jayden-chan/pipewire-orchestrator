import { warn } from "console";
import { Readable } from "stream";
import {
  ActionBinding,
  ButtonBindAction,
  readConfig,
  RuntimeConfig,
} from "../config";
import { Button, Device, Dial, Range } from "../devices";
import { apcKey25 } from "../devices/apcKey25";
import { jalv } from "../eq";
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
import { PipewireItemType } from "../pipewire/types";
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

const findButton = (event: MidiEventNoteOn | MidiEventNoteOff) => {
  return (b: Button) => b.channel === event.channel && b.note === event.note;
};

const findDial = (event: MidiEventControlChange) => {
  return (b: Dial) =>
    b.channel === event.channel && b.controller === event.controller;
};

async function doActionBinding(
  binding: ActionBinding,
  context: WatchMidiContext,
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
      context.midishIn.push(binding.events.map(midiEventToMidish).join("\n"));
      return;
    case "eq::load_preset":
      context.jalvIn.push(`preset ${binding.preset}`);
      return;
    case "eq::show_gui":
      context.jalvIn.push("show");
      return;
    case "pipewire::link":
      return ensureLink(
        binding.src,
        binding.dest,
        context.pipewire.state
      ).catch(handlePwLinkError);
    case "pipewire::unlink":
      return destroyLink(
        binding.src,
        binding.dest,
        context.pipewire.state
      ).catch(handlePwLinkError);
    case "pipewire::exclusive_link":
      return exclusiveLink(
        binding.src,
        binding.dest,
        context.pipewire.state
      ).catch(handlePwLinkError);
  }

  if (binding.type === "mute") {
    let controlVal = 0;
    let ledBytes: ByteTriplet | undefined = undefined;

    if (context.mutes[binding.dial]) {
      context.mutes[binding.dial] = false;
      controlVal = context.dials[binding.dial] ?? 0;
      ledBytes =
        button &&
        buttonLEDBytes(button, "GREEN", button.channel, button.note, context);
    } else {
      context.mutes[binding.dial] = true;
      controlVal = 0;
      ledBytes =
        button &&
        buttonLEDBytes(button, "RED", button.channel, button.note, context);
    }

    manifestDialValue(binding.dial, controlVal, context);
    return amidiSend(context.config.outputMidi, [ledBytes]).catch(
      handleAmidiError
    );
  }

  if (binding.type == "mixer::select") {
    let resetLED = () => {};
    if (button !== undefined) {
      const initialButtonColor = context.buttonColors[button.label];

      const data = buttonLEDBytes(
        button,
        binding.pendingColor,
        button.channel,
        button.note,
        context
      );
      amidiSend(context.config.outputMidi, [data]).catch(handleAmidiError);

      resetLED = () => {
        if (button !== undefined) {
          const data = buttonLEDBytes(
            button,
            initialButtonColor,
            button.channel,
            button.note,
            context
          );
          amidiSend(context.config.outputMidi, [data]).catch(handleAmidiError);
        }
      };
    }

    const mixerChannels = mixerPorts(context.pipewire.state);
    if (mixerChannels === undefined) {
      return;
    }

    const sources: Record<string, NodeWithPorts> = Object.fromEntries(
      audioClients(context.pipewire.state).map((item) => [
        item.node.info?.props?.["application.name"],
        item,
      ])
    );

    context.rofiOpen = true;
    const sourcesString = Object.keys(sources).join("\n");
    const cmd = `echo "${sourcesString}" | rofi -dmenu -i -p "select source:" -theme links`;
    return run(cmd)
      .then(([stdout]) => {
        const source = sources[stdout.trim()];
        const channel = mixerChannels[`Mixer Channel ${binding.channel}`];
        connectAppToMixer(source, channel, context.pipewire.state, true).then(
          () => resetLED()
        );
      })
      .catch((_) => resetLED())
      .finally(() => (context.rofiOpen = false));
  }

  if (binding.type === "range") {
    if (context.ranges[binding.dial] === undefined) {
      const initialMode = binding.modes[0];
      context.ranges[binding.dial] = {
        range: initialMode.range,
        idx: 0,
      };
    }

    const newIdx =
      (context.ranges[binding.dial].idx + 1) % binding.modes.length;
    const newMode = binding.modes[newIdx];
    context.ranges[binding.dial] = {
      range: newMode.range,
      idx: newIdx,
    };

    // update the dial value immediately so we don't get a jump
    // in volume the next time the dial is moved
    manifestDialValue(binding.dial, context.dials[binding.dial] ?? 0, context);

    const data =
      button &&
      buttonLEDBytes(
        button,
        newMode.color,
        button.channel,
        button.note,
        context
      );

    return amidiSend(context.config.outputMidi, [data]).catch(handleAmidiError);
  }
}

async function handleNoteOn(
  event: MidiEventNoteOn,
  context: WatchMidiContext
): Promise<void> {
  if (event.channel === context.config.device.keys.channel) {
    debug(`Key ON ${event.note} velocity ${event.velocity}`);
    return;
  }

  const button = context.config.device.buttons.find(
    (b) => b.channel === event.channel && b.note === event.note
  );

  if (button === undefined) {
    return;
  }

  if (button.label === "Shift") {
    debug("Shift ON");
    context.shiftPressed = true;
    return;
  }

  debug("[button pressed]", button.label);
  const binding = context.config.bindings[button.label];
  if (binding === undefined || binding.type !== "button") {
    return;
  }

  if (context.shiftPressed) {
    if (binding.onShiftLongPress !== undefined) {
      const lp = binding.onShiftLongPress;
      context.buttonTimeouts[button.label] = setTimeout(() => {
        amidiSend(context.config.outputMidi, [
          buttonLEDBytes(
            button,
            lp.color,
            button.channel,
            button.note,
            context
          ),
        ]);

        Promise.all(
          lp.actions.map((bind) =>
            handleButtonBinding(bind, button, event, context)
          )
        ).then(() => Promise.resolve());
      }, lp.timeout);
    }

    if (binding.onShiftPress !== undefined) {
      amidiSend(context.config.outputMidi, [
        buttonLEDBytes(
          button,
          binding.onShiftPress.color,
          button.channel,
          button.note,
          context
        ),
      ]);

      return Promise.all(
        binding.onShiftPress.actions.map((bind) =>
          handleButtonBinding(bind, button, event, context)
        )
      ).then(() => Promise.resolve());
    }

    return;
  }

  if (binding.onLongPress !== undefined) {
    const lp = binding.onLongPress;
    context.buttonTimeouts[button.label] = setTimeout(() => {
      amidiSend(context.config.outputMidi, [
        buttonLEDBytes(button, lp.color, button.channel, button.note, context),
      ]);

      Promise.all(
        lp.actions.map((bind) =>
          handleButtonBinding(bind, button, event, context)
        )
      ).then(() => Promise.resolve());
    }, lp.timeout);
  }

  if (binding.onPress !== undefined) {
    amidiSend(context.config.outputMidi, [
      buttonLEDBytes(
        button,
        binding.onPress.color,
        button.channel,
        button.note,
        context
      ),
    ]);

    return Promise.all(
      binding.onPress.actions.map((bind) =>
        handleButtonBinding(bind, button, event, context)
      )
    ).then(() => Promise.resolve());
  }
}

async function handleButtonBinding(
  binding: ButtonBindAction,
  button: Button,
  event: MidiEventNoteOn | MidiEventNoteOff,
  context: WatchMidiContext
) {
  if (binding.type === "cancel") {
    if (context.rofiOpen) {
      run("xdotool key Escape").catch((err) => error(err));
    } else if (binding.alt !== undefined) {
      return doActionBinding(binding.alt, context, button);
    }
    return;
  }

  if (binding.type === "command") {
    if (context.buttons[button.label] === undefined) {
      const runningState = Object.entries(button.ledStates ?? {}).find(
        // TODO: stop hard coding this
        ([state]) => state === "AMBER"
      );

      const data = buttonLEDBytes(
        button,
        (runningState ?? ["OFF"])[0],
        event.channel,
        event.note,
        context
      );

      amidiSend(context.config.outputMidi, [data]).catch(handleAmidiError);
    }

    const timestamp = new Date().valueOf();
    context.buttons[button.label] = timestamp;

    return doActionBinding(binding, context, button).then(() => {
      if (context.buttons[button.label] !== timestamp) {
        return;
      }

      delete context.buttons[button.label];

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
              context
            );
            amidiSend(context.config.outputMidi, [data]).catch(
              handleAmidiError
            );
          }
        },
        new Date().valueOf() - timestamp < 150 ? 150 : 0
      );
    });
  }

  if (binding.type === "cycle") {
    if (context.buttons[button.label] === undefined) {
      context.buttons[button.label] = 1;
    } else {
      context.buttons[button.label] =
        (context.buttons[button.label] + 1) % binding.items.length;
    }

    const newBind = binding.items[context.buttons[button.label]];
    const data = buttonLEDBytes(
      button,
      newBind.color,
      event.channel,
      event.note,
      context
    );

    amidiSend(context.config.outputMidi, [data]).catch(handleAmidiError);
    return Promise.all(
      newBind.actions.map((bind) => {
        return doActionBinding(bind, context, button);
      })
    ).then(() => Promise.resolve());
  }

  return doActionBinding(binding, context, button);
}

function handleNoteOff(event: MidiEventNoteOff, context: WatchMidiContext) {
  if (event.channel === context.config.device.keys.channel) {
    debug(`Key OFF ${event.note} velocity ${event.velocity}`);
    return;
  }

  const button = context.config.device.buttons.find(findButton(event)!);
  if (button === undefined) {
    return;
  }

  if (button.label === "Shift") {
    debug("Shift OFF");
    context.shiftPressed = false;
    return;
  }

  const binding = context.config.bindings[button.label];
  if (binding === undefined || binding.type !== "button") {
    return;
  }

  if (context.buttonTimeouts[button.label] !== undefined) {
    clearTimeout(context.buttonTimeouts[button.label]);
    delete context.buttonTimeouts[button.label];
  }

  if (binding.onRelease !== undefined) {
    amidiSend(context.config.outputMidi, [
      buttonLEDBytes(
        button,
        binding.onRelease.color,
        button.channel,
        button.note,
        context
      ),
    ]);

    return Promise.all(
      binding.onRelease.actions.map((bind) =>
        handleButtonBinding(bind, button, event, context)
      )
    ).then(() => Promise.resolve());
  }
}

function handleControlChange(
  event: MidiEventControlChange,
  context: WatchMidiContext
) {
  // shift key disables dials. useful for changing
  // dial ranges without having skips in output
  if (context.shiftPressed) {
    return;
  }

  const dial = context.config.device.dials.find(findDial(event)!);
  if (dial !== undefined) {
    debug(`[dial] `, dial.label, event.value);
    manifestDialValue(dial.label, event.value, context);
    context.dials[dial.label] = event.value;
  }
}

type RangeStates = Record<string, { range: Range; idx: number }>;
export type WatchMidiContext = {
  config: RuntimeConfig;
  midishIn: Readable;
  jalvIn: Readable;
  shiftPressed: boolean;
  rofiOpen: boolean;
  ranges: RangeStates;
  mutes: Record<string, boolean>;
  dials: Record<string, number>;
  buttons: Record<string, number>;
  buttonColors: Record<string, string>;
  buttonTimeouts: Record<string, NodeJS.Timeout>;
  pipewire: {
    state: PipewireDump;
    timeout: NodeJS.Timeout | undefined;
    prevDevices: Record<string, boolean>;
  };
};

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
  const [eqPromise, jalvIn] = jalv();

  const device = DEVICE_CONFS[dev];
  if (device === undefined) {
    error(`No device config available for "${dev}"`);
    return 1;
  }

  const config: RuntimeConfig = { ...rawConfig, device };
  const onConnectRules: Array<[string, ActionBinding[]]> = config.pipewire.rules
    .filter((rule) => rule.onConnect !== undefined)
    .map((rule) => [rule.node, rule.onConnect]) as [string, ActionBinding[]][];

  const onDisconnectRules: Array<[string, ActionBinding[]]> =
    config.pipewire.rules
      .filter((rule) => rule.onDisconnect !== undefined)
      .map((rule) => [rule.node, rule.onDisconnect]) as [
      string,
      ActionBinding[]
    ][];

  const mixerRules: Array<[string, number | "round_robin"]> =
    config.pipewire.rules
      .filter((rule) => rule.mixerChannel !== undefined)
      .map((rule) => [rule.node, rule.mixerChannel]) as [
      string,
      number | "round_robin"
    ][];

  const context: WatchMidiContext = {
    config,
    midishIn,
    jalvIn,
    shiftPressed: false,
    rofiOpen: false,
    buttons: {},
    buttonColors: {},
    buttonTimeouts: {},
    mutes: {},
    dials: {},
    pipewire: {
      timeout: undefined,
      prevDevices: Object.fromEntries([
        ...onConnectRules.map(([node]) => [node, false]),
        ...onDisconnectRules.map(([node]) => [node, true]),
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
    defaultLEDStates(context.config.bindings, context)
  );

  pipewire.on("data", (data) => {
    updateDump(data.toString(), context.pipewire.state);

    if (context.pipewire.timeout !== undefined) {
      context.pipewire.timeout.refresh();
      return;
    }

    context.pipewire.timeout = setTimeout(() => {
      const pwItems = Object.values(context.pipewire.state.items);
      const pwPorts = pwItems.filter(
        (i) => i.type === PipewireItemType.PipeWireInterfacePort
      );
      onConnectRules
        .filter(
          ([node]) =>
            context.pipewire.prevDevices[node] === false &&
            pwItems.some(findPwNode(node))
        )
        .forEach(([, rule]) =>
          rule.forEach((binding) => doActionBinding(binding, context))
        );

      onDisconnectRules
        .filter(
          ([node]) =>
            context.pipewire.prevDevices[node] === true &&
            !pwItems.some(findPwNode(node))
        )
        .forEach(([, rule]) =>
          rule.forEach((binding) => doActionBinding(binding, context))
        );

      mixerRules.forEach(([nodeName, channel]) => {
        const node = pwItems.find(findPwNode(nodeName));
        if (node === undefined) {
          return;
        }

        if (channel === "round_robin") {
          warn("[mixer] round robin mixer assignment isn't implemented yet!");
          return;
        }

        const mixerChannels = mixerPorts(context.pipewire.state);
        if (mixerChannels === undefined) {
          return;
        }

        const outputPorts = pwPorts.filter(
          (p) =>
            p.info?.props?.["node.id"] === node.id &&
            p.info?.["direction"] === "output"
        );

        connectAppToMixer(
          {
            node,
            ports: outputPorts,
          },
          mixerChannels[`Mixer Channel ${channel}`],
          context.pipewire.state
        ).catch((err) => error(`[mixer-auto-connect]`, err));
      });

      Object.keys(context.pipewire.prevDevices).forEach((device) => {
        context.pipewire.prevDevices[device] = pwItems.some(findPwNode(device));
      });
    }, UPDATE_HOOK_TIMEOUT_MS);
  });

  stream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;
    debug("[midi]", event);

    switch (event.type) {
      case MidiEventType.NoteOn:
        handleNoteOn(event, context);
        break;
      case MidiEventType.NoteOff:
        handleNoteOff(event, context);
        break;
      case MidiEventType.ControlChange:
        handleControlChange(event, context);
        break;
      default:
        log(event);
    }
  });

  try {
    await Promise.race([
      watchMidiPromise,
      pipewirePromise,
      midishPromise,
      eqPromise,
    ]);
    return 0;
  } catch (err) {
    error(`Problem ocurred with midi watch: exit code ${err}`);
    return 1;
  }
}
