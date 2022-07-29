import { exec } from "child_process";
import { Bindings, DialRange } from "./config";
import { Button, Device } from "./devices";
import { debug, warn } from "./logger";
import { ByteTriplet, midiEventToNumber, MidiEventType } from "./midi";

export function run(cmd: string): Promise<[string, string]> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve([stdout, stderr]);
    });
  });
}

export function rangeLEDBytes(
  button: Button,
  mode: DialRange,
  channel: number,
  note: number
): ByteTriplet | undefined {
  if (button.ledStates !== undefined) {
    const requestedColor = mode.color;
    const ledState = Object.entries(button.ledStates).find(([color]) => {
      return color === requestedColor;
    });

    debug(`[setRangeLed]`, button, mode, channel, note);

    if (ledState === undefined) {
      warn(
        `Button ${button.label} doesn't support requested color ${requestedColor}`
      );
    } else {
      return {
        b1: (midiEventToNumber(MidiEventType.NoteOff) << 4) | channel,
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
      const devKey = Object.entries(devMapping.buttons).find(
        ([, b]) => b.label === key
      );

      if (devKey === undefined) {
        return undefined;
      }

      if (binding.type === "range") {
        const mode = binding.modes[0];
        const [channel, note] = devKey[0].split(":").map((n) => Number(n));
        return rangeLEDBytes(devKey[1], mode, channel, note);
      }

      if (binding.type === "command") {
        const onState = Object.entries(devKey[1].ledStates ?? {}).find(
          ([state]) => state === "ON"
        );

        if (onState !== undefined) {
          const [channel, note] = devKey[0].split(":").map((n) => Number(n));
          return {
            b1: (midiEventToNumber(MidiEventType.NoteOff) << 4) | channel,
            b2: note,
            b3: onState[1],
          };
        }
      }
    })
    .filter((f) => f !== undefined) as ByteTriplet[];
}
