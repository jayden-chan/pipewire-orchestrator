import { spawn } from "child_process";
import { Readable } from "stream";
import { MidiEvent } from ".";
import { debug, log, warn } from "../logger";
import { Process, ProcessFailureError } from "../runnable";

export function midiEventToMidish(
  event: MidiEvent,
  flags?: { highPrecisionControl: boolean } | number
): string {
  let cmd = "";
  switch (event.type) {
    case "NOTE_ON":
    case "NOTE_OFF":
      throw new Error("cannot use NoteOn or NoteOff events with midish");
    case "POLYPHONIC_AFTERTOUCH":
      cmd = `oaddev {kat out${event.channel} ${event.note} ${event.pressure}}`;
      break;
    case "CONTROL_CHANGE":
      if (typeof flags !== "number" && flags?.highPrecisionControl) {
        cmd = `oaddev {xctl out${event.channel} ${event.controller} ${event.value}}`;
      } else {
        cmd = `oaddev {ctl out${event.channel} ${event.controller} ${event.value}}`;
      }
      break;
    case "PROGRAM_CHANGE":
      cmd = `oaddev {xpc out${event.channel} ${event.program}}`;
      break;
    case "CHANNEL_PRESSURE_AFTERTOUCH":
      cmd = `oaddev {cat out${event.channel} ${event.pressure}}`;
      break;
    case "PITCH_BEND":
      const amount = (event.msb << 4) | event.lsb;
      cmd = `oaddev {bend out${event.channel} ${amount}}`;
      break;
  }

  return cmd;
}

export function midish(id: string): [Promise<Process>, Readable] {
  const stream = new Readable({
    read() {},
  });

  const prom = new Promise<Process>(async (resolve, reject) => {
    let restart = true;
    while (1) {
      log(`[midish]`, "starting midish");
      const cmd = spawn("stdbuf", ["-i0", "-o0", "-e0", "midish"]);
      restart = true;

      let co = "out0";
      const channelRe = /(out\d+)/;

      const streamDataFn = (data: any) => {
        let midishCmd = data.toString() as string;
        if (!midishCmd.endsWith("\n")) {
          midishCmd += "\n";
        }

        const [, channel] = midishCmd.match(channelRe) ?? [];
        if (channel !== undefined && channel !== co) {
          co = channel;
          midishCmd = `co ${co}\n${midishCmd}`;
        }

        debug(`[midish] [cmd]`, midishCmd.replace(/\r?\n/g, "<CR>"));

        cmd.stdin.write(midishCmd, (err) => {
          if (err) {
            reject({ error: err });
          }
        });
      };

      stream.on("data", streamDataFn);

      cmd.on("close", (exitCode) => {
        const msg = `midish process exited with code ${exitCode}`;
        log(msg);

        stream.removeListener("data", streamDataFn);

        if (!restart) {
          if (exitCode === 0) {
            resolve({ id, exitCode });
          } else {
            reject(new ProcessFailureError(msg, id, exitCode ?? 1));
          }
        }
      });

      cmd.stderr.on("data", (data) => {
        const line: string = data.toString().trim();
        warn(`[midish-stderr]`, line);
        if (line.includes("sensing timeout")) {
          warn(
            `[midish-timeout]`,
            "midish sensing timeout detected, restarting midish"
          );
          restart = true;
          cmd.kill();
        }
      });

      cmd.stdout.on("data", (data) => {
        const line: string = data.toString().trim();
        log(`[midish-stdout]`, line);
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

      log(`[midish]`, "midish startup finished, waiting for exit");
      await new Promise<void>((resolve) => cmd.on("exit", () => resolve()));
    }
  });

  return [prom, stream];
}
