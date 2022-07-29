import { spawn } from "child_process";
import { Readable } from "stream";
import { debug, error, log, warn } from "../logger";
import { run } from "../util";

export type ByteTriplet = {
  b1: number;
  b2: number;
  b3: number;
};

export enum MidiEventType {
  NoteOn = "NOTE_ON",
  NoteOff = "NOTE_OFF",
  PolyphonicAftertouch = "POLYPHONIC_AFTERTOUCH",
  ControlChange = "CONTROL_CHANGE",
  ProgramChange = "PROGRAM_CHANGE",
  ChannelPressureAftertouch = "CHANNEL_PRESSURE_AFTERTOUCH",
  PitchBend = "PITCH_BEND",
}

export type MidiEvent =
  | {
      type: MidiEventType.NoteOn;
      channel: number;
      note: number;
      velocity: number;
    }
  | {
      type: MidiEventType.NoteOff;
      channel: number;
      note: number;
      velocity: number;
    }
  | {
      type: MidiEventType.PolyphonicAftertouch;
      channel: number;
      note: number;
      pressure: number;
    }
  | {
      type: MidiEventType.ControlChange;
      channel: number;
      controller: number;
      value: number;
    }
  | {
      type: MidiEventType.ProgramChange;
      channel: number;
      program: number;
    }
  | {
      type: MidiEventType.ChannelPressureAftertouch;
      channel: number;
      pressure: number;
    }
  | {
      type: MidiEventType.PitchBend;
      channel: number;
      lsb: number;
      msb: number;
    };

export function midiEventToNumber(event: MidiEventType): number {
  switch (event) {
    case MidiEventType.NoteOn:
      return 0b1000;
    case MidiEventType.NoteOff:
      return 0b1001;
    case MidiEventType.PolyphonicAftertouch:
      return 0b1010;
    case MidiEventType.ControlChange:
      return 0b1011;
    case MidiEventType.ProgramChange:
      return 0b1100;
    case MidiEventType.ChannelPressureAftertouch:
      return 0b1101;
    case MidiEventType.PitchBend:
      return 0b1110;
  }
}

export function midiNumberToEvent(num: number): MidiEventType {
  switch (num) {
    case 0b1000:
      return MidiEventType.NoteOn;
    case 0b1001:
      return MidiEventType.NoteOff;
    case 0b1010:
      return MidiEventType.PolyphonicAftertouch;
    case 0b1011:
      return MidiEventType.ControlChange;
    case 0b1100:
      return MidiEventType.ProgramChange;
    case 0b1101:
      return MidiEventType.ChannelPressureAftertouch;
    case 0b1110:
      return MidiEventType.PitchBend;
    default:
      throw new Error(
        `Unknown MIDI event type "${num.toString(16).padStart(2, "0")}" found`
      );
  }
}

export async function amidiSend(port: string, data: ByteTriplet) {
  const b1Str = data.b1.toString(16).padStart(2, "0");
  const b2Str = data.b2.toString(16).padStart(2, "0");
  const b3Str = data.b3.toString(16).padStart(2, "0");
  const hex = `${b1Str}${b2Str}${b3Str}`;
  await run(`amidi -p "${port}" --send-hex="${hex}"`);
}

export async function amidiSendBatched(port: string, items: ByteTriplet[]) {
  const hex = items
    .map((i) => {
      const b1Str = i.b1.toString(16).padStart(2, "0");
      const b2Str = i.b2.toString(16).padStart(2, "0");
      const b3Str = i.b3.toString(16).padStart(2, "0");
      return `${b1Str}${b2Str}${b3Str}`;
    })
    .join("");
  debug(hex);
  await run(`amidi -p "${port}" --send-hex="${hex}"`);
}

export function watchMidi(channel: string): [Promise<void>, Readable] {
  const stream = new Readable({
    read() {},
  });

  const prom = new Promise<void>((resolve, reject) => {
    const cmd = spawn("amidi", ["-p", channel, "--dump"]);
    cmd.on("close", (code) => {
      log(`amidi process exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject(code);
      }
    });
    cmd.stderr.on("data", (data) => {
      error(`amidi stderr: ${data.toString()}`);
    });
    cmd.stdout.on("data", (data) => {
      const lines = (data.toString() as string)
        .split(/\r?\n/g)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      lines
        .map((line) => {
          if (line.length !== 6 && line.length !== 4) {
            warn(`encountered hex line that wasn't 2 or 3 bytes long: ${line}`);
            return undefined;
          }
          const b1 = parseInt(line.slice(0, 2), 16);
          const b2 = parseInt(line.slice(2, 4), 16);
          const b3 = line.length > 4 ? parseInt(line.slice(4, 6), 16) : 0;

          const channel = b1 & 0b00001111;

          let event: MidiEvent | undefined;
          let type: MidiEventType;
          try {
            type = midiNumberToEvent(b1 >> 4);
          } catch (e) {
            return undefined;
          }

          switch (type) {
            case MidiEventType.NoteOn:
            case MidiEventType.NoteOff:
              event = { type, channel, note: b2, velocity: b3 };
              break;
            case MidiEventType.PolyphonicAftertouch:
              event = { type, channel, note: b2, pressure: b3 };
              break;
            case MidiEventType.ControlChange:
              event = { type, channel, controller: b2, value: b3 };
              break;
            case MidiEventType.ProgramChange:
              event = { type, channel, program: b2 };
              break;
            case MidiEventType.ChannelPressureAftertouch:
              event = { type, channel, pressure: b2 };
              break;
            case MidiEventType.PitchBend:
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
