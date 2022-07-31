import { swapAmps } from "./commands/swap_amps";
import { watchMidiCommand } from "./commands/watch_midi";

async function main() {
  const cmd = process.argv[2];
  if (cmd === undefined) {
    console.error(`Specify a command: "watch_midi", or "swap_amps"`);
    return;
  }

  if (cmd === "watch_midi") {
    const device = process.argv[3];
    if (device === undefined) {
      console.error(`Usage: watch_midi </path/to/config.json>`);
      return;
    }

    const exitCode = await watchMidiCommand(device);
    process.exit(exitCode);
  }

  if (cmd === "swap_amps") {
    await swapAmps();
    return;
  }

  console.error(
    `Invalid command: "${cmd}". Options: "watch_midi", or "swap_amps"`
  );
}

main();
