import { spawn } from "child_process";
import { Readable } from "stream";
import { MidiEvent, MidiEventType } from ".";
import { debug, error, log } from "../logger";

export function midiEventToMidish(
  event: MidiEvent,
  flags?: { highPrecisionControl: boolean } | number
): string {
  let cmd = "";
  switch (event.type) {
    case MidiEventType.NoteOn:
    case MidiEventType.NoteOff:
      throw new Error("cannot use NoteOn or NoteOff events with midish");
    case MidiEventType.PolyphonicAftertouch:
      cmd = `oaddev {kat out${event.channel} ${event.note} ${event.pressure}}`;
      break;
    case MidiEventType.ControlChange:
      if (typeof flags !== "number" && flags?.highPrecisionControl) {
        cmd = `oaddev {xctl out${event.channel} ${event.controller} ${event.value}}`;
      } else {
        cmd = `oaddev {ctl out${event.channel} ${event.controller} ${event.value}}`;
      }
      break;
    case MidiEventType.ProgramChange:
      cmd = `oaddev {xpc out${event.channel} ${event.program}}`;
      break;
    case MidiEventType.ChannelPressureAftertouch:
      cmd = `oaddev {cat out${event.channel} ${event.pressure}}`;
      break;
    case MidiEventType.PitchBend:
      const amount = (event.msb << 4) | event.lsb;
      cmd = `oaddev {bend out${event.channel} ${amount}}`;
      break;
  }

  return cmd;
}

export function midish(): [Promise<void>, Readable] {
  const stream = new Readable({
    read() {},
  });

  const prom = new Promise<void>((resolve, reject) => {
    const cmd = spawn("stdbuf", ["-i0", "-o0", "-e0", "midish"]);

    cmd.on("close", (code) => {
      log(`midish process exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject({ code });
      }
    });

    cmd.stderr.on("data", (data) => {
      error(`[midish]: ${data.toString().trim()}`);
    });

    cmd.stdout.on("data", (data) => {
      log(`[midish]: ${data.toString().trim()}`);
    });

    let co = "out0";
    const channelRe = /(out\d+)/;

    stream.on("data", (data) => {
      let midishCmd = data.toString() as string;
      if (!midishCmd.endsWith("\n")) {
        midishCmd += "\n";
      }

      const [, channel] = midishCmd.match(channelRe) ?? [];
      if (channel !== undefined && channel !== co) {
        co = channel;
        midishCmd = `co ${co}\n${midishCmd}`;
      }

      debug(`[midish] [cmd]:`, midishCmd.replace(/\r?\n/g, "<CR>"));

      cmd.stdin.write(midishCmd, (err) => {
        if (err) {
          reject({ error: err });
        }
      });
    });

    const initCommands = [];

    // set up the midish output device and
    // output channels 1-16 (0-indexed)
    // TODO: stop hard-coding the output device
    initCommands.push(`dnew 0 "14:0" rw`);
    initCommands.push("i");
    for (let i = 0; i < 16; i++) {
      initCommands.push(`onew out${i} {0 ${i}}`);
    }
    initCommands.push("co out0");

    cmd.stdin.write(initCommands.join("\n") + "\n", (err) => {
      if (err) {
        reject({ error: err });
      }
    });
  });

  return [prom, stream];
}
