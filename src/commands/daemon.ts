import { ChildProcess, exec } from "child_process";
import { Readable } from "stream";
import {
  ActionBinding,
  ButtonBindAction,
  readConfig,
  RuntimeConfig,
} from "../config";
import { Button, Device, Dial, Range } from "../devices";
import { apcKey25 } from "../devices/apcKey25";
import { handleAmidiError, handlePwLinkError } from "../errors";
import { jalv } from "../jalv";
import { debug, error, log, warn } from "../logger";
import {
  amidiSend,
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
  freeMixerPorts,
  isAssignedToMixer,
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
  context: WatchCmdContext
): Promise<void> {
  switch (binding.type) {
    case "command":
      return run(binding.command)
        .then(() => Promise.resolve())
        .catch((err) => {
          error("[run-command]", err);
        });
    case "cancel":
      if (context.rofiOpen) {
        run("xdotool key Escape").catch((err) => error(err));
      } else if (binding.alt !== undefined) {
        return doActionBinding(binding.alt, context);
      }
      return;
    case "midi":
      context.midishIn.push(binding.events.map(midiEventToMidish).join("\n"));
      return;
    case "lv2::load_preset":
      if (context.pluginStreams[binding.pluginName] !== undefined) {
        context.pluginStreams[binding.pluginName].push(
          `preset ${binding.preset}`
        );
      }
      return;
    case "lv2::show_gui":
      if (context.pluginStreams[binding.pluginName] !== undefined) {
        context.pluginStreams[binding.pluginName].push("show");
      }
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
    case "range":
      context.ranges[binding.dial] = binding.range;
      // update the dial value immediately so we don't get a jump
      // in volume the next time the dial is moved
      return manifestDialValue(
        binding.dial,
        context.dials[binding.dial] ?? 0,
        context
      );
    case "led::save":
      context.ledSaveStates[binding.button] =
        context.buttonColors[binding.button];
      return;
  }

  if (binding.type === "mute") {
    let controlVal = 0;
    if (binding.mute) {
      context.mutes[binding.dial] = true;
      controlVal = 0;
    } else {
      context.mutes[binding.dial] = false;
      controlVal = context.dials[binding.dial] ?? 0;
    }

    return manifestDialValue(binding.dial, controlVal, context);
  }

  if (binding.type === "led::set" || binding.type === "led::restore") {
    const button = context.config.device.buttons.find(
      (b) => b.label === binding.button
    );

    if (button === undefined) {
      warn(`[led::set]`, `button "${binding.button}" not found`);
      return;
    }

    const color =
      binding.type === "led::set"
        ? binding.color
        : context.ledSaveStates[binding.button];

    const data = buttonLEDBytes(
      button,
      color,
      button.channel,
      button.note,
      context
    );
    return amidiSend(context.config.outputMidi, [data]).catch(handleAmidiError);
  }

  if (binding.type == "mixer::select") {
    // can't open rofi twice at the same time
    if (context.rofiOpen) {
      return;
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
      .then(async ([stdout]) => {
        const source = sources[stdout.trim()];
        const channel = mixerChannels[`Mixer Channel ${binding.channel}`];
        return connectAppToMixer(
          source,
          channel,
          context.pipewire.state,
          "smart"
        );
      })
      .catch((_) => {})
      .finally(() => {
        context.rofiOpen = false;
        (binding.onFinish ?? []).forEach((action) =>
          doActionBinding(action, context).catch((err) => {
            error(
              `[mixer::select]`,
              `Error ocurred in onFinish handler: ${err}`
            );
          })
        );
      });
  }
}

async function handleNoteOn(
  event: MidiEventNoteOn,
  context: WatchCmdContext
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

  const executionFunc = (actions: ButtonBindAction[], color?: string) => {
    return () => {
      amidiSend(context.config.outputMidi, [
        buttonLEDBytes(button, color, button.channel, button.note, context),
      ]);

      Promise.all(
        actions.map((bind) => handleButtonBinding(bind, button, event, context))
      )
        .then(() => Promise.resolve())
        .catch((err) => error(`[button-executor]`, err));
    };
  };

  if (context.shiftPressed) {
    if (binding.onShiftLongPress !== undefined) {
      const { color, actions, timeout } = binding.onShiftLongPress;
      const longPressFunc = executionFunc(actions, color);
      const to: TimeoutFuncPair = [
        setTimeout(() => {
          longPressFunc();
          delete context.buttonTimeouts[button.label];
        }, timeout),
        undefined,
      ];
      if (binding.onShiftPress !== undefined) {
        to[1] = executionFunc(
          binding.onShiftPress.actions,
          binding.onShiftPress.color
        );
      }

      context.buttonTimeouts[button.label] = to;
    } else if (binding.onShiftPress !== undefined) {
      executionFunc(binding.onShiftPress.actions, binding.onShiftPress.color)();
    }
  } else {
    if (binding.onLongPress !== undefined) {
      const { color, actions, timeout } = binding.onLongPress;
      const longPressFunc = executionFunc(actions, color);
      const to: TimeoutFuncPair = [
        setTimeout(() => {
          longPressFunc();
          delete context.buttonTimeouts[button.label];
        }, timeout),
        undefined,
      ];
      if (binding.onPress !== undefined) {
        to[1] = executionFunc(binding.onPress.actions, binding.onPress.color);
      }

      context.buttonTimeouts[button.label] = to;
    } else if (binding.onPress !== undefined) {
      executionFunc(binding.onPress.actions, binding.onPress.color)();
    }
  }
}

async function handleButtonBinding(
  binding: ButtonBindAction,
  button: Button,
  event: MidiEventNoteOn | MidiEventNoteOff,
  context: WatchCmdContext
) {
  if (binding.type === "command") {
    const onFinished = (timestamp: number) => {
      delete context.buttons[button.label];

      setTimeout(
        () => {
          (binding.onFinish ?? []).forEach((action) =>
            doActionBinding(action, context).catch((err) =>
              error(
                `[command::onFinish]`,
                `Error ocurred in command onFinish function: `,
                err
              )
            )
          );
        },
        new Date().valueOf() - timestamp < 150 ? 150 : 0
      );
    };

    if (
      binding.cancelable === true &&
      context.buttons[button.label] !== undefined
    ) {
      const [timestamp, process] = context.buttons[button.label];
      if (process !== undefined) {
        process.kill();
      }
      onFinished(timestamp);
      return;
    }

    const timestamp = new Date().valueOf();
    const childProcess = exec(binding.command, (err) => {
      const buttonContext = context.buttons[button.label];
      // command has already been killed, no need to run
      // the callback
      if (buttonContext === undefined) {
        return;
      }

      if (err) {
        error(`[cmd-exec]`, err);
      }

      // if another instance of the command is running concurrently as well,
      // we shouldn't run the onFinished function
      if (buttonContext[0] !== timestamp) {
        return;
      }
      onFinished(timestamp);
    });

    context.buttons[button.label] = [timestamp, childProcess];
    return;
  }

  if (binding.type === "cycle") {
    if (context.buttons[button.label] === undefined) {
      context.buttons[button.label] = [1];
    } else {
      context.buttons[button.label] = [
        (context.buttons[button.label][0] + 1) % binding.items.length,
      ];
    }

    const newBind = binding.items[context.buttons[button.label][0]];
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
        return doActionBinding(bind, context);
      })
    ).then(() => Promise.resolve());
  }

  return doActionBinding(binding, context);
}

function handleNoteOff(event: MidiEventNoteOff, context: WatchCmdContext) {
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

  const timeout = context.buttonTimeouts[button.label];
  if (timeout !== undefined) {
    clearTimeout(timeout[0]);
    if (timeout[1] !== undefined) {
      timeout[1]();
    }

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
  context: WatchCmdContext
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

function handleMixerRule(
  nodeName: string,
  channel: number | "round_robin",
  context: WatchCmdContext
) {
  const appsToConnect = audioClients(context.pipewire.state).filter((source) =>
    findPwNode(nodeName)(source.node)
  );

  const dump = context.pipewire.state;
  const mixerChannels = mixerPorts(dump);
  if (mixerChannels === undefined || appsToConnect.length === 0) {
    return;
  }

  let currentlyAssignedChannel: NodeWithPorts | undefined;
  for (const app of appsToConnect) {
    const assignedChannel = isAssignedToMixer(app, mixerChannels, dump);

    if (assignedChannel !== undefined) {
      currentlyAssignedChannel = assignedChannel;
      break;
    }
  }

  appsToConnect.forEach((appToConnect) => {
    // if the app is currently assigned to a mixer channel, re-run
    // the channel assignment function with the same settings. this ensures
    // that all apps matching the search term are assigned to the same channel.
    if (currentlyAssignedChannel !== undefined) {
      debug(
        `[mixer-reassign] connecting ${nodeName} to ${currentlyAssignedChannel.node.id}`
      );
      connectAppToMixer(
        appToConnect,
        currentlyAssignedChannel,
        dump,
        "smart"
      ).catch((err) => error(`[mixer-reconnect]`, err));
      return;
    }

    // app isn't assigned to a mixer channel, find one and
    // assign it
    let chan: string | undefined = undefined;
    if (typeof channel === "number") {
      chan = `Mixer Channel ${channel}`;
    } else {
      const occupiedPorts = freeMixerPorts(mixerChannels, dump);
      if (occupiedPorts === undefined) {
        return;
      }

      const freeChannel = Object.entries(occupiedPorts).find(
        ([, free]) => free
      );
      chan = freeChannel?.[0];
    }

    if (chan !== undefined) {
      debug(`[mixer-assign] connecting ${nodeName} to ${chan}`);
      connectAppToMixer(appToConnect, mixerChannels[chan], dump, "smart").catch(
        (err) => error(`[mixer-auto-connect]`, err)
      );
    }
  });
}

type PluginName = string;
type ButtonLabel = string;
type DialLabel = string;
type ShiftPressed = boolean;
type TimeoutFuncPair = [NodeJS.Timeout, (() => void) | undefined];

export type WatchCmdContext = {
  config: RuntimeConfig;
  midishIn: Readable;
  pluginStreams: Record<PluginName, Readable>;
  shiftPressed: ShiftPressed;
  rofiOpen: boolean;
  ranges: Record<DialLabel, Range>;
  mutes: Record<DialLabel, boolean>;
  dials: Record<DialLabel, number>;
  ledSaveStates: Record<ButtonLabel, string>;
  buttons: Record<ButtonLabel, [number] | [number, ChildProcess]>;
  buttonColors: Record<ButtonLabel, string>;
  buttonTimeouts: Record<ButtonLabel, TimeoutFuncPair>;
  pipewire: {
    state: PipewireDump;
    timeout: NodeJS.Timeout | undefined;
    prevDevices: Record<string, boolean>;
  };
};

export async function daemonCommand(configPath: string): Promise<0 | 1> {
  const rawConfig = await readConfig(configPath);
  log("Loaded config file");

  const dev = rawConfig.device;
  const devicePort = await findDevicePort(dev);
  if (!devicePort) {
    error("Failed to extract port from device listing");
    return 1;
  }

  const outputPort = await findDevicePort(rawConfig.outputMidi);
  if (!outputPort) {
    error("Failed to extract port from device listing");
    return 1;
  }

  const [aconnectListing] = await run("aconnect --list");
  for (const [d1, d2] of rawConfig.connections) {
    await connectMidiDevices(aconnectListing, d1, d2);
  }

  const [watchMidiPromise, stream] = watchMidi(devicePort);
  const [pipewirePromise, pipewire] = watchPwDump();
  const [midishPromise, midishIn] = midish();

  // mapping of plugin name to its input stream
  const pluginStreams = Object.fromEntries(
    rawConfig.pipewire.plugins.map((plugin) => {
      log(`[lv2] starting plugin "${plugin.name}"`);
      const [prom, stream] = jalv(plugin, rawConfig.lv2Path);
      prom.catch((err) => {
        error(`Error: plugin "${plugin.name}" crashed!`);
        error(err);
      });
      return [plugin.name, stream];
    })
  );

  const device = DEVICE_CONFS[dev];
  if (device === undefined) {
    error(`No device config available for "${dev}"`);
    return 1;
  }

  const config: RuntimeConfig = {
    ...rawConfig,
    device,
    outputMidi: outputPort,
  };
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

  const context: WatchCmdContext = {
    config,
    midishIn,
    pluginStreams,
    shiftPressed: false,
    rofiOpen: false,
    ledSaveStates: {},
    buttons: {},
    buttonColors: {},
    buttonTimeouts: {},
    mutes: {},
    dials: Object.fromEntries(
      device.dials.map((d) => [d.label, (d.range[1] - d.range[0]) / 2])
    ),
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

      mixerRules.forEach(([nodeName, channel]) =>
        handleMixerRule(nodeName, channel, context)
      );

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
    await Promise.race([watchMidiPromise, pipewirePromise, midishPromise]);
    return 0;
  } catch (err) {
    error(`Problem ocurred with midi watch: exit code ${err}`);
    return 1;
  }
}
