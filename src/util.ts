import { exec, ExecException } from "child_process";
import { Bindings } from "./config";
import { Button, Device } from "./devices";
import { debug, error, warn } from "./logger";
import { ByteTriplet, midiEventToNumber, MidiEventType } from "./midi";

const PORT_RE = /client (\d+): '(.*?)'/;
const deviceRe = /^IO\s+([a-zA-Z0-9:,]+)\s+(.*?)$/;

export type RunCommandError = {
  error: ExecException;
  stdout: string;
  stderr: string;
};

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
  const devicePortLine = amidilLines.find((line) => line.includes(name));
  if (devicePortLine === undefined) {
    error(`Unable to locate device "${name}"`);
    return undefined;
  }

  const [, devicePort] = devicePortLine.match(deviceRe) ?? [];
  return devicePort;
}

export async function connectMidiDevices(
  d1: string,
  d2: string
): Promise<void> {
  const [aconnectListing] = await run("aconnect --list");

  const devices = aconnectListing.split(/\r?\n/g).map((line) => {
    const [, clientNum, name] = line.match(PORT_RE) ?? [];
    debug(clientNum, name);
    return { clientNum, name };
  });

  const d1Client = devices.find((d) => d.name === d1)?.clientNum;
  const d2Client = devices.find((d) => d.name === d2)?.clientNum;

  if (d1Client === undefined || d2Client === undefined) {
    error(`Failed to locate either "${d1}" or "${d2}"`);
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

export function buttonLEDBytes(
  button: Button,
  color: string | undefined,
  channel: number,
  note: number
): ByteTriplet | undefined {
  if (button.ledStates !== undefined && color !== undefined) {
    const ledState = Object.entries(button.ledStates).find(
      ([c]) => c === color
    );

    debug(`[buttonLEDBytes]`, button, color, channel, note);

    if (ledState === undefined) {
      warn(`Button ${button.label} doesn't support requested color ${color}`);
    } else {
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
  devMapping: Device
): ByteTriplet[] {
  return Object.entries(bindings)
    .map(([key, binding]) => {
      const button = devMapping.buttons.find((b) => b.label === key);
      if (button === undefined) {
        return undefined;
      }

      if (binding.type === "range") {
        const mode = binding.modes[0];
        return buttonLEDBytes(button, mode.color, button.channel, button.note);
      }

      if (binding.type === "mute") {
        return buttonLEDBytes(button, "GREEN", button.channel, button.note);
      }

      if (binding.type === "cycle") {
        const color = binding.items[0].color ?? "OFF";
        return buttonLEDBytes(button, color, button.channel, button.note);
      }

      if (binding.type === "command") {
        const onState = Object.entries(button.ledStates ?? {}).find(
          ([state]) => state === "ON" || state === "GREEN"
        );

        if (onState !== undefined) {
          return {
            b1: (midiEventToNumber(MidiEventType.NoteOn) << 4) | button.channel,
            b2: button.note,
            b3: onState[1],
          };
        }
      }
    })
    .filter((f) => f !== undefined) as ByteTriplet[];
}
