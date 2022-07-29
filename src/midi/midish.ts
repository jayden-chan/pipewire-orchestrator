import { spawn } from "child_process";
import { Readable } from "stream";
import { error, log } from "../logger";

export function midish(): [Promise<void>, Readable] {
  const stream = new Readable({
    read() {},
  });

  const prom = new Promise<void>((resolve, reject) => {
    const cmd = spawn("midish");
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

    stream.on("data", (data) => {
      let midishCmd = data.toString() as string;
      if (!midishCmd.endsWith("\n")) {
        midishCmd += "\n";
      }

      cmd.stdin.write(midishCmd, (err) => {
        if (err) {
          reject({ error: err });
        }
      });
    });

    const initSeq = [];

    initSeq.push(`dnew 0 "14:0" rw`);
    initSeq.push("i");
    for (let i = 0; i < 16; i++) {
      initSeq.push(`onew out${i} {0 ${i}}`);
    }
    initSeq.push("co out0");

    cmd.stdin.write(initSeq.join("\n") + "\n", (err) => {
      if (err) {
        reject({ error: err });
      }
    });
  });

  return [prom, stream];
}
