import { swapAmps } from "./commands/swap_amps";
import { watch } from "./commands/watch";
import { watchMidiCommand } from "./commands/watch_midi";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "watch") {
    await watch();
    return;
  }

  if (cmd === "watch_midi") {
    const device = process.argv[3] ?? "APC Key 25 MIDI";
    const exitCode = await watchMidiCommand(device);
    process.exit(exitCode);
  }

  if (cmd === "swap_amps") {
    await swapAmps();
    return;
  }
}

main();
