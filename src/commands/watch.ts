import { error, log } from "../logger";
import { ensureLink, PipewireDump, updateDump, watchPwDump } from "../pipewire";
import { PipewireItemType } from "../pipewire/types";

const UPDATE_HOOK_TIMEOUT_MS = 500;
const QC35_NAME = "Bose QuietComfort 35";
const QC35_EQ_NAME = "LSP Parametric EQ x16 Stereo (QC35)";
const QC35_EQ_L = { node: QC35_EQ_NAME, port: "Output L" };
const QC35_EQ_R = { node: QC35_EQ_NAME, port: "Output R" };
const QC35_L = { node: QC35_NAME, port: "playback_FL" };
const QC35_R = { node: QC35_NAME, port: "playback_FR" };

export async function watch() {
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
}
