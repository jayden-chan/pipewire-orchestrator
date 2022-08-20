import { exec, ExecException } from "child_process";
import { WatchCmdContext } from "./commands/daemon";
import { Bindings, PassthroughBinding } from "./config";
import { Button, Dial } from "./devices";
import { debug, error, warn } from "./logger";
import { ByteTriplet, midiEventToNumber, MidiEventType } from "./midi";
import { midiEventToMidish } from "./midi/midish";
import {
  findMixer,
  MixerChannels,
  NodeWithPorts,
  PipewireDump,
} from "./pipewire";

const PORT_RE = /client (\d+): '(.*?)'/;
const deviceRe = /^IO\s+([a-zA-Z0-9:,]+)\s+(.*?)$/;

export type RunCommandError = {
  error: ExecException;
  stdout: string;
  stderr: string;
};

const MAP_FUNCTIONS = {
  IDENTITY: (input: any) => input,
  SQUARED: (input: number) => input * input,
  SQRT: (input: number) => Math.sqrt(input),
  TAPER: (input: number) => {
    if (0.49 <= input && input <= 0.51) {
      return input;
    }

    const f = (input: number) => 2 * input ** 2;
    if (input <= 0.5) {
      return f(input);
    } else {
      return -f(-input + 1) + 1;
    }
  },
};

export function computeMappedVal(
  input: number,
  dial: Dial,
  context: WatchCmdContext,
  binding: PassthroughBinding
): number {
  let pct = input / (dial.range[1] - dial.range[0]);
  if (context.ranges[dial.label] !== undefined) {
    const [start, end] = context.ranges[dial.label].range;
    pct = pct * (end - start) + start;
  }

  const mappedPct = MAP_FUNCTIONS[binding.mapFunction ?? "IDENTITY"](pct);
  return Math.round(mappedPct * 16383);
}

export function manifestDialValue(
  dialName: string,
  value: number,
  context: WatchCmdContext
) {
  const dialBinding = Object.entries(context.config.bindings).find(
    ([dial]) => dial === dialName
  );

  const dial = context.config.device.dials.find((d) => d.label === dialName);

  if (
    dial === undefined ||
    dialBinding === undefined ||
    dialBinding[1].type !== "passthrough"
  ) {
    return;
  }

  const newVal = computeMappedVal(value, dial, context, dialBinding[1]);

  context.midishIn.push(
    midiEventToMidish(
      {
        type: MidiEventType.ControlChange,
        channel: dialBinding[1].outChannel,
        controller: dialBinding[1].outController,
        value: newVal,
      },
      { highPrecisionControl: true }
    )
  );
}

export function run(cmd: string): Promise<[string, string]> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
        return;
      }
      resolve([stdout, stderr]);
    });
  });
}

export async function findDevicePort(
  name: string
): Promise<string | undefined> {
  const [amidil] = await run("amidi --list-devices");
  const amidilLines = amidil.split(/\r?\n/g);
  const searchName = name.startsWith("virt:") ? "Virtual Raw MIDI" : name;
  const devicePortLines = amidilLines.filter((line) =>
    line.includes(searchName)
  );
  const ports = devicePortLines
    .map((l) => l.match(deviceRe))
    .filter((l) => l !== null);
  if (devicePortLines.length === 0 || ports.length === 0) {
    error(`Unable to locate device "${name}"`);
    return undefined;
  }

  const ret =
    ports[name.startsWith("virt:") ? Number(name.replace("virt:", "")) : 0];

  if (ret !== undefined) {
    return ret![1];
  } else {
    error(`Unable to locate device "${name}"`);
    return undefined;
  }
}

export async function connectMidiDevices(
  aconnectListing: string,
  d1: string,
  d2: string
): Promise<void> {
  const devices = aconnectListing.split(/\r?\n/g).map((line) => {
    const [, clientNum, name] = line.match(PORT_RE) ?? [];
    debug(clientNum, name);
    return { clientNum, name };
  });

  const d1Client = devices.find((d) => d.name === d1)?.clientNum;
  const d2Client = devices.find((d) => d.name === d2)?.clientNum;

  if (d1Client === undefined || d2Client === undefined) {
    warn(`Failed to locate either "${d1}" or "${d2}"`);
    return;
  }

  try {
    const command = `aconnect ${d1Client} ${d2Client}`;
    debug("[connectMidiDevices]", command);
    await run(command);
  } catch (e) {
    const error = e as RunCommandError;
    if (error.stderr.trim() !== "Connection is already subscribed") {
      debug(e);
      throw e;
    }
  }
}

export function isAssignedToMixer(
  node: NodeWithPorts,
  mixerChannels: MixerChannels,
  dump: PipewireDump
): NodeWithPorts | undefined {
  const mixer = findMixer(dump);
  if (mixer === undefined) {
    return undefined;
  }

  for (const mixerChannel of Object.values(mixerChannels)) {
    for (const channelPort of mixerChannel.ports) {
      const revLinks = dump.links.reverse[`${mixer.id}:${channelPort.id}`];
      if (
        revLinks !== undefined &&
        revLinks.links.some(([destNode]) => destNode.id === node.node.id)
      ) {
        return mixerChannel;
      }
    }
  }

  return undefined;
}

export function freeMixerPorts(
  mixerChannels: MixerChannels,
  dump: PipewireDump
): Record<string, boolean> | undefined {
  const mixer = findMixer(dump);
  if (mixer === undefined) {
    return;
  }

  return Object.fromEntries(
    Object.entries(mixerChannels).map(([channel, nodeWithPorts]) => {
      const isFreePort = nodeWithPorts.ports.every((port) => {
        const revLinks = dump.links.reverse[`${mixer.id}:${port.id}`];
        return revLinks === undefined || revLinks.links.length === 0;
      });

      return [channel, isFreePort];
    })
  );
}

export function buttonLEDBytes(
  button: Button,
  color: string | undefined,
  channel: number,
  note: number,
  context: WatchCmdContext
): ByteTriplet | undefined {
  if (button.ledStates !== undefined && color !== undefined) {
    const ledState = Object.entries(button.ledStates).find(
      ([c]) => c === color
    );

    debug(`[buttonLEDBytes]`, button, color, channel, note);

    if (ledState === undefined) {
      warn(`Button ${button.label} doesn't support requested color ${color}`);
    } else {
      context.buttonColors[button.label] = color;
      return {
        b1: (midiEventToNumber(MidiEventType.NoteOn) << 4) | channel,
        b2: note,
        b3: ledState[1],
      };
    }
  }
}

export function defaultLEDStates(
  bindings: Bindings,
  context: WatchCmdContext
): ByteTriplet[] {
  return Object.entries(bindings).flatMap(([key, buttonBind]) => {
    const button = context.config.device.buttons.find((b) => b.label === key);
    if (button === undefined || buttonBind.type === "passthrough") {
      return [];
    }

    const binds = Object.values(buttonBind).flatMap((val) => {
      if (val !== "button") {
        return val.actions;
      }
      return [];
    });

    const commands: (ByteTriplet | undefined)[] = [];
    binds.forEach((binding) => {
      let color = "OFF";
      switch (binding.type) {
        case "command":
        case "mute":
          color = "ON";
          break;
        case "range":
          color = binding.modes[0].color;
          break;
        case "cycle":
          color = binding.items[0].color ?? "OFF";
          break;
      }

      commands.push(
        buttonLEDBytes(button, color, button.channel, button.note, context)
      );
    });

    return commands.filter((state) => state !== undefined) as ByteTriplet[];
  });
}
