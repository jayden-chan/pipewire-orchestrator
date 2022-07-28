import { swapAmps } from "./commands/swap_amps";
import { watch } from "./commands/watch";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "watch") {
    await watch();
    return;
  }

  if (cmd === "swap_amps") {
    await swapAmps();
    return;
  }
}

main();
