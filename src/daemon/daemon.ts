import { ChildProcess, exec } from "child_process";
import { Readable } from "stream";
import { Action, readConfig, RuntimeConfig } from "../config";
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
  watchMidi,
} from "../midi";
import { midiEventToMidish, midish } from "../midi/midish";
import {
  audioClients,
  connectAppToMixer,
  destroyLink,
  ensureLink,
  exclusiveLink,
  findMixer,
  findPwNode,
  mixerPorts,
  NodeWithPorts,
  PipewireDump,
  updateDump,
  watchPwDump,
} from "../pipewire";
import { Process, ProcessFailureError } from "../runnable";
import { dumpState, restoreState } from "../state";
import {
  buttonLEDBytes,
  connectMidiDevices,
  defaultButtonColors,
  findDevicePort,
  freeMixerPorts,
  isAssignedToMixer,
  manifestDialValue,
  objectId,
  run,
} from "../util";

const UPDATE_HOOK_TIMEOUT_MS = 100;
const DEFAULT_LONG_PRESS_TIMEOUT_MS = 500;
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

async function doAction(action: Action, context: DaemonContext): Promise<void> {
  switch (action.type) {
    case "cancel":
      if (context.rofiOpen) {
        run("xdotool key Escape").catch((err) => error(err));
      } else if (action.alt !== undefined) {
        return doAction(action.alt, context);
      }
      return;
    case "midi":
      context.midishIn.push(action.events.map(midiEventToMidish).join("\n"));
      return;
    case "lv2::load_preset":
      if (context.pluginStreams[action.pluginName] !== undefined) {
        context.pluginStreams[action.pluginName].push(
          `preset ${action.preset}`
        );
      }
      return;
    case "pipewire::link":
      return ensureLink(action.src, action.dest, context.pipewire.state).catch(
        handlePwLinkError
      );
    case "pipewire::unlink":
      return destroyLink(action.src, action.dest, context.pipewire.state).catch(
        handlePwLinkError
      );
    case "pipewire::exclusive_link":
      return exclusiveLink(
        action.src,
        action.dest,
        context.pipewire.state
      ).catch(handlePwLinkError);
    case "range":
      context.ranges[action.dial] = action.range;
      // update the dial value immediately so we don't get a jump
      // in volume the next time the dial is moved
      return manifestDialValue(
        action.dial,
        context.dials[action.dial] ?? 0,
        context
      );
    case "led::save":
      context.ledSaveStates[action.button] =
        context.buttonColors[action.button];
      return;
  }

  if (action.type === "cycle") {
    const id = await objectId(action);
    context.cycleStates[id] =
      ((context.cycleStates[id] ?? 0) + 1) % action.actions.length;

    const newBind = action.actions[context.cycleStates[id]];
    return Promise.all(
      newBind.map((bind) => {
        return doAction(bind, context);
      })
    ).then(() => Promise.resolve());
  }

  if (action.type === "config::reload") {
    const configLoadResult = await loadConfig(context.config.configPath);
    if ("error" in configLoadResult) {
      error(`[action-config-reload]`, `Invalid config`);
      return;
    }

    const { config } = configLoadResult;
    context.config = config;

    const prevDevices = Object.fromEntries([
      ...config.onConnectRules.map(([node]) => [node, false]),
      ...config.onDisconnectRules.map(([node]) => [node, false]),
    ]);

    context.pipewire.prevDevices = {
      ...prevDevices,
      ...context.pipewire.prevDevices,
    };

    log(`[action-config-reload]`, "Reloaded config!");
    return;
  }

  if (action.type === "mute") {
    let controlVal = 0;
    if (action.mute) {
      context.mutes[action.dial] = true;
      controlVal = 0;
    } else {
      context.mutes[action.dial] = false;
      controlVal = context.dials[action.dial] ?? 0;
    }

    return manifestDialValue(action.dial, controlVal, context);
  }

  if (action.type === "led::set" || action.type === "led::restore") {
    const button = context.config.device.buttons.find(
      (b) => b.label === action.button
    );

    if (button === undefined) {
      warn(`[led-set]`, `button "${action.button}" not found`);
      return;
    }

    const color =
      action.type === "led::set"
        ? action.color
        : context.ledSaveStates[action.button];

    const data = buttonLEDBytes(
      button,
      color,
      button.channel,
      button.note,
      context
    );
    return amidiSend(context.config.outputMidi, [data]).catch(handleAmidiError);
  }

  if (action.type === "command") {
    const id = await objectId(action);
    const onFinished = (timestamp: number) => {
      delete context.commandStates[id];

      setTimeout(
        () => {
          (action.onFinish ?? []).forEach((action) =>
            doAction(action, context).catch((err) =>
              error(
                `[command-on-finish]`,
                `Error ocurred in command onFinish function: `,
                err
              )
            )
          );
        },
        Date.now() - timestamp < 150 ? 150 : 0
      );
    };

    if (action.cancelable === true && context.commandStates[id] !== undefined) {
      const [timestamp, process] = context.commandStates[id];
      if (process !== undefined) {
        process.kill();
      }
      onFinished(timestamp);
      return;
    }

    const timestamp = Date.now();
    const childProcess = exec(action.command, (err) => {
      const commandState = context.commandStates[id];
      // command has already been killed, no need to run
      // the callback
      if (commandState === undefined) {
        return;
      }

      if (err) {
        error(`[cmd-exec]`, err);
      }

      // if another instance of the command is running concurrently as well,
      // we shouldn't run the onFinished function
      if (commandState[0] !== timestamp) {
        return;
      }
      onFinished(timestamp);
    });

    context.commandStates[id] = [timestamp, childProcess];
    return;
  }

  if (action.type == "mixer::select") {
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
        const channel = mixerChannels[`Mixer Channel ${action.channel}`];
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
        (action.onFinish ?? []).forEach((action) =>
          doAction(action, context).catch((err) => {
            error(
              `[mixer-select]`,
              `Error ocurred in onFinish handler: ${err}`
            );
          })
        );
      });
  }
}

async function handleNoteOn(
  event: MidiEventNoteOn,
  context: DaemonContext
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

  debug("[button-pressed]", button.label);
  const binding = context.config.bindings[button.label];
  if (binding === undefined || binding.type !== "button") {
    return;
  }

  const executionFunc = (actions: Action[], color?: string) => {
    return () => {
      amidiSend(context.config.outputMidi, [
        buttonLEDBytes(button, color, button.channel, button.note, context),
      ]);

      Promise.all(actions.map((bind) => doAction(bind, context)))
        .then(() => Promise.resolve())
        .catch((err) => error(`[button-executor]`, err));
    };
  };

  if (context.shiftPressed) {
    if (binding.onShiftLongPress !== undefined) {
      const { actions, timeout: bindTimeout } = binding.onShiftLongPress;
      const timeout = bindTimeout ?? DEFAULT_LONG_PRESS_TIMEOUT_MS;
      const longPressFunc = executionFunc(actions);
      const to: TimeoutFuncPair = [
        setTimeout(() => {
          longPressFunc();
          delete context.buttonTimeouts[button.label];
        }, timeout),
        undefined,
      ];
      if (binding.onShiftPress !== undefined) {
        to[1] = executionFunc(binding.onShiftPress.actions);
      }

      context.buttonTimeouts[button.label] = to;
    } else if (binding.onShiftPress !== undefined) {
      executionFunc(binding.onShiftPress.actions)();
    }
  } else {
    if (binding.onLongPress !== undefined) {
      const { actions, timeout: bindTimeout } = binding.onLongPress;
      const timeout = bindTimeout ?? DEFAULT_LONG_PRESS_TIMEOUT_MS;
      const longPressFunc = executionFunc(actions);
      const to: TimeoutFuncPair = [
        setTimeout(() => {
          longPressFunc();
          delete context.buttonTimeouts[button.label];
        }, timeout),
        undefined,
      ];
      if (binding.onPress !== undefined) {
        to[1] = executionFunc(binding.onPress.actions);
      }

      context.buttonTimeouts[button.label] = to;
    } else if (binding.onPress !== undefined) {
      executionFunc(binding.onPress.actions)();
    }
  }
}

function handleNoteOff(event: MidiEventNoteOff, context: DaemonContext) {
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
    return Promise.all(
      binding.onRelease.actions.map((bind) => doAction(bind, context))
    ).then(() => Promise.resolve());
  }
}

function handleControlChange(
  event: MidiEventControlChange,
  context: DaemonContext
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
  context: DaemonContext
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
        "[mixer-reassign]",
        `connecting ${nodeName} to ${currentlyAssignedChannel.node.id}`
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

export type PluginName = string;
export type ButtonLabel = string;
export type DialLabel = string;
export type ShiftPressed = boolean;
export type Timestamp = number;
export type ID = string;
export type TimeoutFuncPair = [NodeJS.Timeout, (() => void) | undefined];

export type DaemonContext = {
  config: RuntimeConfig;
  midishIn: Readable;
  pluginStreams: Record<PluginName, Readable>;
  shiftPressed: ShiftPressed;
  rofiOpen: boolean;
  ranges: Record<DialLabel, Range>;
  mutes: Record<DialLabel, boolean>;
  dials: Record<DialLabel, number>;
  ledSaveStates: Record<ButtonLabel, string>;
  commandStates: Record<ID, [Timestamp, ChildProcess]>;
  cycleStates: Record<ID, number>;
  buttonColors: Record<ButtonLabel, string>;
  buttonTimeouts: Record<ButtonLabel, TimeoutFuncPair>;
  pipewire: {
    state: PipewireDump;
    timeout: NodeJS.Timeout | undefined;
    prevDevices: Record<string, boolean>;
  };
};

export type RestorableDaemonFields = Pick<
  DaemonContext,
  | "ranges"
  | "mutes"
  | "dials"
  | "ledSaveStates"
  | "cycleStates"
  | "buttonColors"
>;

async function loadConfig(
  configPath: string
): Promise<{ config: RuntimeConfig } | { error: number }> {
  const rawConfig = await readConfig(configPath);
  log("Loaded config file");

  const [aconnectListing] = await run("aconnect --list");
  for (const [d1, d2] of rawConfig.connections) {
    await connectMidiDevices(aconnectListing, d1, d2);
  }

  const dev = rawConfig.device;
  const devicePort = await findDevicePort(rawConfig.inputMidi);
  if (!devicePort) {
    error("Failed to extract port from device listing");
    return { error: 1 };
  }

  const outputPort = await findDevicePort(rawConfig.outputMidi);
  if (!outputPort) {
    error("Failed to extract port from device listing");
    return { error: 1 };
  }

  const device = DEVICE_CONFS[dev];
  if (device === undefined) {
    error(`No device config available for "${dev}"`);
    return { error: 1 };
  }

  const onConnectRules: Array<[string, Action[]]> = rawConfig.pipewire.rules
    .filter((rule) => rule.onConnect !== undefined)
    .map((rule) => [rule.node, rule.onConnect]) as [string, Action[]][];

  const onDisconnectRules: Array<[string, Action[]]> = rawConfig.pipewire.rules
    .filter((rule) => rule.onDisconnect !== undefined)
    .map((rule) => [rule.node, rule.onDisconnect]) as [string, Action[]][];

  const mixerRules: Array<[string, number | "round_robin"]> =
    rawConfig.pipewire.rules
      .filter((rule) => rule.mixerChannel !== undefined)
      .map((rule) => [rule.node, rule.mixerChannel]) as [
      string,
      number | "round_robin"
    ][];

  const config: RuntimeConfig = {
    ...rawConfig,
    configPath,
    onConnectRules,
    onDisconnectRules,
    mixerRules,
    device,
    inputMidi: devicePort,
    outputMidi: outputPort,
  };

  log("Finished loading runtime config");
  return { config };
}

export async function daemonCommand(configPath: string): Promise<number> {
  const configLoadResult = await loadConfig(configPath);
  if ("error" in configLoadResult) {
    return configLoadResult.error;
  }

  let { config } = configLoadResult;

  // mapping of plugin name to its input stream
  const pluginStreams = Object.fromEntries(
    config.pipewire.plugins.map((plugin) => {
      log(`[lv2] starting plugin "${plugin.name}"`);
      const [prom, stream] = jalv(plugin, config.lv2Path);
      prom.catch((err) => {
        error(`Error: plugin "${plugin.name}" crashed!`);
        error(err);
      });
      return [plugin.name, stream];
    })
  );

  const [midishPromise, midishIn] = midish("midish");

  const context: DaemonContext = {
    config,
    midishIn,
    pluginStreams,
    shiftPressed: false,
    rofiOpen: false,
    ledSaveStates: {},
    commandStates: {},
    cycleStates: {},
    buttonColors: {},
    buttonTimeouts: {},
    mutes: {},
    // dials default to 50%
    // TODO: maybe make this a config option?
    dials: Object.fromEntries(
      config.device.dials.map((d) => [d.label, (d.range[1] - d.range[0]) / 2])
    ),
    pipewire: {
      timeout: undefined,
      prevDevices: Object.fromEntries([
        ...config.onConnectRules.map(([node]) => [node, false]),
        ...config.onDisconnectRules.map(([node]) => [node, false]),
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

  await restoreState(context);

  const defaultColors = defaultButtonColors(config.bindings, config.device);
  const contextButtonColors = structuredClone(context.buttonColors);
  context.buttonColors = {
    ...defaultColors.before,
    ...contextButtonColors,
    ...defaultColors.after,
  };

  // set up LED states on initialization
  amidiSend(
    context.config.outputMidi,
    Object.entries(context.buttonColors).map(([label, state]) => {
      const button = context.config.device.buttons.find(
        (b) => b.label === label
      );

      return button
        ? buttonLEDBytes(button, state, button.channel, button.note, context)
        : undefined;
    })
  );

  const [pipewirePromise, pipewire] = watchPwDump("watchPwDump");
  pipewire.on("data", (data) => {
    updateDump(data.toString(), context.pipewire.state);

    if (context.pipewire.timeout !== undefined) {
      context.pipewire.timeout.refresh();
      return;
    }

    context.pipewire.timeout = setTimeout(() => {
      const pwItems = Object.values(context.pipewire.state.items);
      context.config.onConnectRules
        .filter(
          ([node]) =>
            context.pipewire.prevDevices[node] === false &&
            pwItems.some(findPwNode(node))
        )
        .forEach(([, rule]) =>
          rule.forEach((binding) => doAction(binding, context))
        );

      context.config.onDisconnectRules
        .filter(
          ([node]) =>
            context.pipewire.prevDevices[node] === true &&
            !pwItems.some(findPwNode(node))
        )
        .forEach(([, rule]) =>
          rule.forEach((binding) => doAction(binding, context))
        );

      if (findMixer(context.pipewire.state) !== undefined) {
        context.config.mixerRules.forEach(([nodeName, channel]) =>
          handleMixerRule(nodeName, channel, context)
        );
      }

      Object.keys(context.pipewire.prevDevices).forEach((device) => {
        context.pipewire.prevDevices[device] = pwItems.some(findPwNode(device));
      });
    }, UPDATE_HOOK_TIMEOUT_MS);
  });

  const [watchMidiPromise, midiStream] = watchMidi(
    config.inputMidi,
    "watchMidi"
  );

  midiStream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;
    debug("[midi]", event);

    switch (event.type) {
      case "NOTE_ON":
        handleNoteOn(event, context);
        break;
      case "NOTE_OFF":
        handleNoteOff(event, context);
        break;
      case "CONTROL_CHANGE":
        handleControlChange(event, context);
        break;
      default:
        log(event);
    }
  });

  const exitProm = new Promise<Process>((resolve) => {
    const cb = (sig: string) => () => {
      log(`Got ${sig} signal, saving state and exiting`);
      resolve({ exitCode: 0, id: "signal" });
    };

    ["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, cb(sig)));
  });

  try {
    const resolved = await Promise.race([
      watchMidiPromise,
      pipewirePromise,
      midishPromise,
      exitProm,
    ]);

    if (resolved.id === "watchMidi") {
      warn("Device was unplugged");
    }

    await dumpState(context);
    const allOffStates = context.config.device.buttons
      .filter((b) => b.ledStates?.OFF !== undefined)
      .map((b) => buttonLEDBytes(b, "OFF", b.channel, b.note, context));
    await amidiSend(context.config.outputMidi, allOffStates);
    return 0;
  } catch (err) {
    if (err instanceof ProcessFailureError) {
      error(`Problem ocurred with ${err.id}: exit code ${err.exitCode}`);
      return err.exitCode;
    }

    return 1;
  }
}
