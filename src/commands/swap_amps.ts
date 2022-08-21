import { debug, error } from "../logger";
import { pipewireDump } from "../pipewire";
import { run } from "../util";

const GUITAR_NODE =
  "alsa_input.usb-Focusrite_Scarlett_Solo_USB_Y7E3FPF1B27EC5-00.analog-stereo";
const GUITAR_PORT = "capture_FR";

const NEXT_AMP: { [key: string]: string } = {
  "Clean Amp": "Metal Amp",
  "Metal Amp": "Clean Amp",
};

export async function swapAmps() {
  const dump = await pipewireDump();
  const [guitarKey, guitarVal] = Object.entries(dump.links.forward).find(
    ([_, value]) => {
      const nodeName = value.item.info?.props?.["node.name"];
      const portName = value.port.info?.props?.["port.name"];
      return nodeName === GUITAR_NODE && portName === GUITAR_PORT;
    }
  ) ?? [undefined];

  if (guitarKey === undefined) {
    return;
  }

  const links = guitarVal.links.filter((l) =>
    l[0].info?.props?.["node.name"]?.includes("Amp")
  );

  if (links.length === 1) {
    const currLink = links[0];
    const currName = currLink[0].info?.props?.["node.name"];
    const currPort = currLink[1].info?.props?.["port.name"];
    if (currName === undefined || currPort === undefined) {
      error(
        `Failed to determine current amp name/port ${currName}, ${currPort}`
      );
      return;
    }

    const deleteCommand = `pw-link -d "${GUITAR_NODE}:${GUITAR_PORT}" "${currName}:${currPort}"`;
    const createCommand = `pw-link "${GUITAR_NODE}:${GUITAR_PORT}" "${
      NEXT_AMP[currName] ?? "Clean Amp"
    }:input_1"`;

    debug(`[command] ${deleteCommand}`);
    await run(deleteCommand);
    debug(`[command] ${createCommand}`);
    await run(createCommand);
  }
}
