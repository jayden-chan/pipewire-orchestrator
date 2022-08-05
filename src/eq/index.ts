import { spawn } from "child_process";
import { Readable } from "stream";
import { debug, error, log } from "../logger";

export function jalv(): [Promise<void>, Readable] {
  const stream = new Readable({
    read() {},
  });

  const prom = new Promise<void>((resolve, reject) => {
    const cmd = spawn(
      "stdbuf",
      [
        "-i0",
        "-o0",
        "-e0",
        "/home/jayden/Dev/Testing/jalv/build/jalv.gtk3",
        "-n",
        "System Equalizer",
        "http://lsp-plug.in/plugins/lv2/para_equalizer_x16_stereo",
      ],
      {
        env: {
          ...process.env,
          DISPLAY: ":0",
          LV2_PATH: "/usr/lib/lv2:/home/jayden/.config/dotfiles/afx/lv2",
        },
      }
    );

    cmd.on("close", (code) => {
      log(`jalv.gtk3 process exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject({ code });
      }
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
          error(`[jalv]: ${line}`);
        });
      }
    });

    cmd.stdout.on("data", (data) => {
      const filtered = filterOutput(data);
      if (filtered.length !== 0) {
        filtered.forEach((line) => {
          log(`[jalv]: ${line}`);
        });
      }
    });

    stream.on("data", (data) => {
      let command = data.toString() as string;
      if (!command.endsWith("\n")) {
        command += "\n";
      }

      debug(`[jalv] [command]:`, command.replace(/\r?\n/g, "<CR>"));

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
