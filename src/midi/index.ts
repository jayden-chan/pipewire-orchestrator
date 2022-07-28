import { spawn } from "child_process";
import { Readable } from "stream";
import { error, log, warn } from "../logger";
import { run } from "../util";

export type MidiEvent =
  | {
      type: "NOTE_ON";
      channel: number;
      note: number;
      velocity: number;
    }
  | {
      type: "NOTE_OFF";
      channel: number;
      note: number;
      velocity: number;
    }
  | {
      type: "POLYPHONIC_AFTERTOUCH";
      channel: number;
      note: number;
      pressure: number;
    }
  | {
      type: "CONTROL_CHANGE";
      channel: number;
      controller: number;
      value: number;
    }
  | {
      type: "PROGRAM_CHANGE";
      channel: number;
      program: number;
    }
  | {
      type: "CHANNEL_PRESSURE_AFTERTOUCH";
      channel: number;
      pressure: number;
    }
  | {
      type: "PITCH_BEND";
      channel: number;
      lsb: number;
      msb: number;
    };

export async function amidiSend(port: string, hex: string) {
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
          switch (b1 >> 4) {
            case 0b1000:
              event = { type: "NOTE_OFF", channel, note: b2, velocity: b3 };
              break;
            case 0b1001:
              event = { type: "NOTE_ON", channel, note: b2, velocity: b3 };
              break;
            case 0b1010:
              event = {
                type: "POLYPHONIC_AFTERTOUCH",
                channel,
                note: b2,
                pressure: b3,
              };
              break;
            case 0b1011:
              event = {
                type: "CONTROL_CHANGE",
                channel,
                controller: b2,
                value: b3,
              };
              break;
            case 0b1100:
              event = { type: "PROGRAM_CHANGE", channel, program: b2 };
              break;
            case 0b1101:
              event = {
                type: "CHANNEL_PRESSURE_AFTERTOUCH",
                channel,
                pressure: b2,
              };
              break;
            case 0b1110:
              event = { type: "PITCH_BEND", channel, lsb: b2, msb: b3 };
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
