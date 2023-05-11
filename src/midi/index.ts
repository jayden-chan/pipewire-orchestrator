import { spawn } from "child_process";
import { Readable } from "stream";
import { debug, error, log, warn } from "../logger";
import { Process, ProcessFailureError } from "../runnable";
import { run } from "../util";

export type ByteTriplet = {
  b1: number;
  b2: number;
  b3: number;
};

export type MidiEventType =
  | "NOTE_ON"
  | "NOTE_OFF"
  | "POLYPHONIC_AFTERTOUCH"
  | "CONTROL_CHANGE"
  | "PROGRAM_CHANGE"
  | "CHANNEL_PRESSURE_AFTERTOUCH"
  | "PITCH_BEND";

export type MidiEventNoteOn = {
  type: "NOTE_ON";
  channel: number;
  note: number;
  velocity: number;
};

export type MidiEventNoteOff = {
  type: "NOTE_OFF";
  channel: number;
  note: number;
  velocity: number;
};

export type MidiEventPolyphonicAftertouch = {
  type: "POLYPHONIC_AFTERTOUCH";
  channel: number;
  note: number;
  pressure: number;
};

export type MidiEventControlChange = {
  type: "CONTROL_CHANGE";
  channel: number;
  controller: number;
  value: number;
};

export type MidiEventProgramChange = {
  type: "PROGRAM_CHANGE";
  channel: number;
  program: number;
};

export type MidiEventChannelPressureAftertouch = {
  type: "CHANNEL_PRESSURE_AFTERTOUCH";
  channel: number;
  pressure: number;
};

export type MidiEventPitchBend = {
  type: "PITCH_BEND";
  channel: number;
  lsb: number;
  msb: number;
};

export type MidiEvent =
  | MidiEventNoteOn
  | MidiEventNoteOff
  | MidiEventPolyphonicAftertouch
  | MidiEventControlChange
  | MidiEventProgramChange
  | MidiEventChannelPressureAftertouch
  | MidiEventPitchBend;

export function midiEventToNumber(event: MidiEventType): number {
  switch (event) {
    case "NOTE_OFF":
      return 0b1000;
    case "NOTE_ON":
      return 0b1001;
    case "POLYPHONIC_AFTERTOUCH":
      return 0b1010;
    case "CONTROL_CHANGE":
      return 0b1011;
    case "PROGRAM_CHANGE":
      return 0b1100;
    case "CHANNEL_PRESSURE_AFTERTOUCH":
      return 0b1101;
    case "PITCH_BEND":
      return 0b1110;
  }
}

export function midiNumberToEvent(num: number): MidiEventType | undefined {
  switch (num) {
    case 0b1000:
      return "NOTE_OFF";
    case 0b1001:
      return "NOTE_ON";
    case 0b1010:
      return "POLYPHONIC_AFTERTOUCH";
    case 0b1011:
      return "CONTROL_CHANGE";
    case 0b1100:
      return "PROGRAM_CHANGE";
    case 0b1101:
      return "CHANNEL_PRESSURE_AFTERTOUCH";
    case 0b1110:
      return "PITCH_BEND";
    default: {
      const msg = `Unknown MIDI event type "${num
        .toString(16)
        .padStart(2, "0")}" found`;

      debug(`[midi-byte-to-event-type] ${msg}`);
      return undefined;
    }
  }
}

export async function amidiSend(
  port: string,
  items: (ByteTriplet | undefined)[]
) {
  const hex = items
    .filter((i) => i !== undefined)
    .map((i) => {
      const b1Str = i!.b1.toString(16).padStart(2, "0");
      const b2Str = i!.b2.toString(16).padStart(2, "0");
      const b3Str = i!.b3.toString(16).padStart(2, "0");
      return `${b1Str}${b2Str}${b3Str}`;
    })
    .join("");
  debug(`[amidiSend]`, hex);
  await run(`amidi -p "${port}" --send-hex="${hex}"`);
}

export function watchMidi(
  channel: string,
  id: string
): [Promise<Process>, Readable] {
  const stream = new Readable({
    read() {},
  });

  const prom = new Promise<Process>((resolve, reject) => {
    const cmd = spawn("amidi", ["-p", channel, "--dump"]);
    let prevB1 = 0;
    cmd.on("close", (exitCode) => {
      const msg = `amidi process exited with code ${exitCode}`;
      log(msg);
      if (exitCode === 0) {
        resolve({ id, exitCode });
      } else {
        reject(new ProcessFailureError(msg, id, exitCode ?? 1));
      }
    });

    cmd.stderr.on("data", (data) => {
      error(`[amidi-stderr]`, data.toString());
    });

    cmd.stdout.on("data", (data) => {
      const lines = (data.toString() as string)
        .split(/\r?\n/g)
        .map((l) => l.replace(/\s+/g, ""))
        .filter((l) => l.length > 0);

      lines
        .map((line) => {
          if (line.length !== 6 && line.length !== 4) {
            warn(`encountered hex line that wasn't 2 or 3 bytes long: ${line}`);
            return undefined;
          }

          debug("[midi-raw]", line);

          let b1 = parseInt(line.slice(0, 2), 16);
          let b2 = parseInt(line.slice(2, 4), 16);
          let b3 = line.length > 4 ? parseInt(line.slice(4, 6), 16) : 0;

          // For some reason the virtual midi driver omits the first byte
          // if it's the same as the previous message.
          if (midiNumberToEvent(b1 >> 4) === undefined && line.length === 4) {
            b3 = b2;
            b2 = b1;
            b1 = prevB1;
          }

          const channel = b1 & 0b00001111;

          let event: MidiEvent | undefined;
          const type = midiNumberToEvent(b1 >> 4);
          if (type === undefined) {
            return undefined;
          }

          prevB1 = b1;

          switch (type) {
            case "NOTE_ON":
            case "NOTE_OFF":
              event = { type, channel, note: b2, velocity: b3 };
              break;
            case "POLYPHONIC_AFTERTOUCH":
              event = { type, channel, note: b2, pressure: b3 };
              break;
            case "CONTROL_CHANGE":
              event = { type, channel, controller: b2, value: b3 };
              break;
            case "PROGRAM_CHANGE":
              event = { type, channel, program: b2 };
              break;
            case "CHANNEL_PRESSURE_AFTERTOUCH":
              event = { type, channel, pressure: b2 };
              break;
            case "PITCH_BEND":
              event = { type, channel, lsb: b2, msb: b3 };
              break;
          }

          return event;
        })
        .filter((event) => event !== undefined)
        .forEach((event) => {
          stream.push(JSON.stringify(event));
        });
    });
  });

  return [prom, stream];
}
