import { daemonCommand } from "./daemon/daemon";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "daemon") {
    const device = process.argv[3];
    if (device === undefined) {
      console.error(`Usage: daemon </path/to/config.json>`);
      return;
    }

    const exitCode = await daemonCommand(device);
    process.exit(exitCode);
  }

  console.error(`Specify a valid command. Options: "daemon"`);
}

main();
