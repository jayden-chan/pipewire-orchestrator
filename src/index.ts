import { EventQueue } from "./eventQueue";
import { error, log } from "./logger";
import {
  watchPwDump,
  pipewireDump,
  updateDump,
  PipewireDump,
  ensureLink,
} from "./pipewire";
import { PipewireItemType } from "./pipewire/types";
import { run } from "./util";

const UPDATE_HOOK_TIMEOUT_MS = 500;

const GUITAR_NODE =
  "alsa_input.usb-Focusrite_Scarlett_Solo_USB_Y7E3FPF1B27EC5-00.analog-stereo";
const GUITAR_PORT = "capture_FR";

const QC35_NAME = "Bose QuietComfort 35";
const QC35_EQ_NAME = "LSP Parametric EQ x16 Stereo (QC35)";
const QC35_EQ_L = { node: QC35_EQ_NAME, port: "Output L" };
const QC35_EQ_R = { node: QC35_EQ_NAME, port: "Output R" };
const QC35_L = { node: QC35_NAME, port: "playback_FL" };
const QC35_R = { node: QC35_NAME, port: "playback_FR" };

const NEXT_AMP: { [key: string]: string } = {
  "Clean Amp": "Metal Amp",
  "Metal Amp": "Clean Amp",
};

async function main() {
  const [promise, stream] = watchPwDump();

  const dump: PipewireDump = {
    items: {},
    links: {
      forward: {},
      reverse: {},
    },
  };

  let prevHadQC35 = false;

  let timeoutHandle: NodeJS.Timeout | undefined = undefined;

  stream.on("data", (data) => {
    console.error("-".repeat(150));
    updateDump(data.toString(), dump);

    if (timeoutHandle !== undefined) {
      timeoutHandle.refresh();
    } else {
      timeoutHandle = setTimeout(() => {
        log("running update hook");
        const hasQC35 = Object.values(dump.items).some(
          (item) =>
            item.type === PipewireItemType.PipeWireInterfaceNode &&
            item.info?.props?.["node.description"] === QC35_NAME
        );

        if (!prevHadQC35 && hasQC35) {
          Promise.all([
            ensureLink(QC35_EQ_L, QC35_L, dump),
            ensureLink(QC35_EQ_R, QC35_R, dump),
          ]).catch((err) => {
            error(err);
            if (err instanceof Error) {
              if (!err.message.includes("failed to link ports: File exists")) {
                throw err;
              }
            }
          });
        }

        prevHadQC35 = hasQC35;
        timeoutHandle = undefined;
      }, UPDATE_HOOK_TIMEOUT_MS);
    }
  });

  await promise;

  const cmd = process.argv[2];
  if (cmd === "swap_amps") {
    const dump = await pipewireDump();
    const [guitarKey, guitarVal] = Object.entries(dump.links.forward).find(
      ([_, value]) => {
        const nodeName = value.item.info?.props?.["node.name"];
        const portName = value.port.info?.props?.["port.name"];
        return nodeName === GUITAR_NODE && portName === GUITAR_PORT;
      }
    ) ?? [undefined];

    if (guitarKey !== undefined && guitarVal.links.length === 1) {
      const currLink = guitarVal.links[0];
      const currName = currLink[0].info?.props?.["node.name"];
      const currPort = currLink[1].info?.props?.["port.name"];
      if (currName === undefined || currPort === undefined) {
        throw new Error(
          `Failed to determine current amp name/port ${currName}, ${currPort}`
        );
      }

      await run(
        `pw-link -d "${GUITAR_NODE}:${GUITAR_PORT}" "${currName}:${currPort}"`
      );
      await run(
        `pw-link "${GUITAR_NODE}:${GUITAR_PORT}" "${
          NEXT_AMP[currName] ?? "Clean Amp"
        }:input_1"`
      );
    }
  }
}

main();
