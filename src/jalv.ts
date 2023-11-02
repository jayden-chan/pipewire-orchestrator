import { spawn } from "child_process";
import { Readable } from "stream";
import { LV2Plugin } from "./config";
import { debug, error, log, warn } from "./logger";

export function jalv(
  plugin: LV2Plugin,
  lv2Path?: string
): [Promise<void>, Readable] {
  const stream = new Readable({
    read() {},
  });

  const prom = new Promise<void>((resolve, reject) => {
    const cmd = spawn(
      "stdbuf",
      ["-i0", "-o0", "-e0", plugin.host, "-n", plugin.name, plugin.uri],
      {
        env: {
          ...process.env,
          DISPLAY: ":0",
          LV2_PATH: lv2Path ?? "/usr/lib/lv2",
        },
      }
    );

    cmd.on("close", (code) => {
      log(`jalv process closed with code ${code}`);
      reject({ code });
    });

    cmd.on("exit", (code) => {
      log(`jalv process exited with code ${code}`);
      reject({ code });
    });

    const controlOutputRe = /^(.*) = (.*)$/;
    // filter out the stuff we don't care about from jalv
    const filterOutput = (out: any) => {
      const data: string = out.toString();
      return data.split(/\r?\n/g).filter((line) => {
        const trimmed = line.trim();
        return (
          trimmed.length > 0 &&
          !trimmed.startsWith(">") &&
          !controlOutputRe.test(trimmed)
        );
      });
    };

    cmd.stderr.on("data", (data) => {
      const filtered = filterOutput(data);
      if (filtered.length !== 0) {
        filtered.forEach((line) => {
          warn(`[jalv-stderr]`, line);
        });
      }
    });

    cmd.stdout.on("data", (data) => {
      const filtered = filterOutput(data);
      if (filtered.length !== 0) {
        filtered.forEach((line) => {
          log(`[jalv-stdout]`, line);
        });
      }
    });

    stream.on("data", (data) => {
      let command = data.toString() as string;
      if (!command.endsWith("\n")) {
        command += "\n";
      }

      debug(`[jalv] [command]`, command.replace(/\r?\n/g, "<CR>"));

      cmd.stdin.write(command, (err) => {
        if (err) {
          error(err);
          reject({ error: err });
        }
      });
    });

    // need to call the presets function so jalv fetches the presets
    // (doesn't fetch when you try to load a preset...)
    setTimeout(() => {
      cmd.stdin.write("presets\n", (err) => {
        if (err) {
          error(err);
          reject({ error: err });
        }
      });
    }, 200);
  });

  return [prom, stream];
}
