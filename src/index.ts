import { exec } from "child_process";

type Links = {
  [key: string]: [[string, string]];
};

const GUITAR_INPUT =
  "alsa_input.usb-Focusrite_Scarlett_Solo_USB_Y7E3FPF1B27EC5-00.analog-stereo:capture_FR";

const NEXT_AMP: { [key: string]: string } = {
  "Clean Amp": "Metal Amp",
  "Metal Amp": "Clean Amp",
};

const DEVICE_RE = /(.*?):(.*?)$/;
const CONNECTION_RE = /(?:->|<-) (.*?):(.*?)$/;

async function main() {
  const [links, revLinks] = await getLinks();
  console.log(links);
  console.log(revLinks);

  const cmd = process.argv[2];
  if (cmd === "swap_amps") {
    const currLinks = links[GUITAR_INPUT];
    if (currLinks !== undefined && currLinks.length === 1) {
      const currLink = currLinks[0];
      await run(`pw-link -d "${GUITAR_INPUT}" "${currLink[0]}:${currLink[1]}"`);
      await run(
        `pw-link "${GUITAR_INPUT}" "${
          NEXT_AMP[currLink[0]] ?? "Clean Amp"
        }:input_1"`
      );
    }
  }
}

async function getLinks(): Promise<[Links, Links]> {
  const [stdout, stderr] = await run("pw-link -l");
  if (stderr.length !== 0) {
    console.error(stderr);
  }

  const forwardLinks: Links = {};
  const reverseLinks: Links = {};
  let currDevice = "";
  const lines = stdout.split(/\r?\n/g);
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }

    if (line[0].trim().length === line[0].length) {
      const [didMatch, device, port] = line.match(DEVICE_RE) ?? [null, "", ""];
      if (!didMatch) {
        console.error(`failed to get device info from ${line}`);
      } else {
        currDevice = `${device}:${port}`;
      }

      continue;
    }

    const [didMatch, device, port] = line.trim().match(CONNECTION_RE) ?? [
      null,
      "",
      "",
    ];
    if (!didMatch) {
      console.error(`failed to get link info from ${line}`);
    } else {
      const pair: [string, string] = [device!, port!];
      if (line.trim().startsWith("|->")) {
        if (forwardLinks[currDevice] === undefined) {
          forwardLinks[currDevice] = [pair];
        } else {
          forwardLinks[currDevice].push(pair);
        }
      } else {
        if (reverseLinks[currDevice] === undefined) {
          reverseLinks[currDevice] = [pair];
        } else {
          reverseLinks[currDevice].push(pair);
        }
      }
    }
  }

  return [forwardLinks, reverseLinks];
}

function run(cmd: string): Promise<[string, string]> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
        return;
      }
      resolve([stdout, stderr]);
    });
  });
}

main();
