import { daemonCommand } from "./commands/daemon";
import { swapAmps } from "./commands/swap_amps";

async function main() {
  const cmd = process.argv[2];
  if (cmd === undefined) {
    console.error(`Specify a command: "daemon", or "swap_amps"`);
    return;
  }

  if (cmd === "daemon") {
    const device = process.argv[3];
    if (device === undefined) {
      console.error(`Usage: daemon </path/to/config.json>`);
      return;
    }

    const exitCode = await daemonCommand(device);
    process.exit(exitCode);
  }

  if (cmd === "swap_amps") {
    await swapAmps();
    return;
  }

  console.error(`Invalid command: "${cmd}". Options: "daemon", or "swap_amps"`);
}

main();
