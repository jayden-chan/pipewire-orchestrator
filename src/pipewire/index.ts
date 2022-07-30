import { Convert, PipewireItem, PipewireItemType } from "./types";
import { Readable } from "stream";
import { run } from "../util";
import { spawn } from "child_process";
import { error, log, warn } from "../logger";

export type Links = {
  [key: string]: {
    item: PipewireItem;
    port: PipewireItem;
    // [node, port]
    links: [PipewireItem, PipewireItem][];
  };
};

export type PipewireItems = {
  [key: number]: PipewireItem;
};

export type PipewireDump = {
  items: PipewireItems;
  links: {
    forward: Links;
    reverse: Links;
  };
};

export type NodeAndPort = {
  node: string;
  port: string;
};

export function findLinkPair(
  src: NodeAndPort,
  dest: NodeAndPort,
  dump: PipewireDump
):
  | {
      srcNode: PipewireItem;
      srcPort: PipewireItem;
      destNode: PipewireItem;
      destPort: PipewireItem;
    }
  | undefined {
  const items = Object.values(dump.items);
  const srcNode = items.find(
    (item) =>
      item.type === PipewireItemType.PipeWireInterfaceNode &&
      item.info?.props?.["node.description"] === src.node
  );

  if (srcNode === undefined) {
    warn("failed to find src node");
    return undefined;
  }

  const destNode = items.find(
    (item) =>
      item.type === PipewireItemType.PipeWireInterfaceNode &&
      item.info?.props?.["node.description"] === dest.node
  );

  if (destNode === undefined) {
    warn("failed to find dest node");
    return undefined;
  }

  const srcPort = items.find(
    (item) =>
      item.type === PipewireItemType.PipeWireInterfacePort &&
      item.info?.props?.["node.id"] === srcNode.id &&
      item.info?.props?.["port.name"] === src.port
  );

  if (srcPort === undefined) {
    warn("failed to locate src port");
    return undefined;
  }

  const destPort = items.find(
    (item) =>
      item.type === PipewireItemType.PipeWireInterfacePort &&
      item.info?.props?.["node.id"] === destNode.id &&
      item.info?.props?.["port.name"] === dest.port
  );

  if (destPort === undefined) {
    warn("failed to locate dest port");
    return undefined;
  }

  return { srcNode, srcPort, destNode, destPort };
}

async function modifyLink(
  src: NodeAndPort,
  dest: NodeAndPort,
  dump: PipewireDump,
  mode: "ENSURE" | "DESTROY"
): Promise<void> {
  const linkItems = findLinkPair(src, dest, dump);
  if (linkItems === undefined) {
    return;
  }

  const { srcNode, srcPort, destNode } = linkItems;
  const srcLinks = dump.links.forward[`${srcNode.id}:${srcPort.id}`];
  if (
    srcLinks === undefined ||
    !srcLinks.links.some((link) => link[0].id === destNode.id)
  ) {
    const flags = mode === "DESTROY" ? "-d" : "";
    const command = `pw-link ${flags} "${src.node}:${src.port}" "${dest.node}:${dest.port}"`;
    log(`[command] ${command}`);
    await run(command);
  }
}

export async function ensureLink(
  src: NodeAndPort,
  dest: NodeAndPort,
  dump: PipewireDump
): Promise<void> {
  await modifyLink(src, dest, dump, "ENSURE");
}

export async function destroyLink(
  src: NodeAndPort,
  dest: NodeAndPort,
  dump: PipewireDump
): Promise<void> {
  await modifyLink(src, dest, dump, "DESTROY");
}

export function watchPwDump(): [Promise<void>, Readable] {
  const stream = new Readable({
    read() {},
  });
  const prom = new Promise<void>((resolve, reject) => {
    const cmd = spawn("pw-dump", ["-m", "--color=never"]);

    cmd.stderr.on("data", (data) => {
      error(`pw-dump stderr: ${data.toString()}`);
    });

    cmd.on("close", (code) => {
      log(`pw-dump process exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject(code);
      }
    });

    let stdoutBuf = "";
    cmd.stdout.on("data", (data) => {
      const dataStr: string = "\n" + data.toString();

      stdoutBuf += dataStr;

      let openBracketIndex = stdoutBuf.indexOf("\n[");
      let closingBracketIndex = stdoutBuf.indexOf("\n]");

      while (openBracketIndex !== -1 && closingBracketIndex !== -1) {
        const data = stdoutBuf.slice(openBracketIndex, closingBracketIndex + 2);

        try {
          JSON.parse(data);
          stream.push(data);
        } catch (e) {
          error("FAILED TO PARSE JSON");
          error(e);
          error("DATA");
          error(data);
          break;
        }

        stdoutBuf =
          stdoutBuf.slice(0, openBracketIndex) +
          stdoutBuf.slice(closingBracketIndex + 2);

        // try not to let newlines accumulate
        if (stdoutBuf.trim().length === 0) {
          stdoutBuf = "";
          break;
        }

        openBracketIndex = stdoutBuf.indexOf("\n[");
        closingBracketIndex = stdoutBuf.indexOf("\n]");
      }
    });
  });

  return [prom, stream];
}

export function updateDump(data: string, dump: PipewireDump): void {
  let parsed: PipewireItem[];
  try {
    parsed = Convert.toPipewireItems(data);
  } catch (e) {
    error("failed to parse");
    error(e);
    throw e;
  }

  parsed.forEach((curr) => {
    dump.items[curr.id] = curr;
  });

  const forwardLinks: Links = {};
  const reverseLinks: Links = {};
  Object.values(dump.items).forEach((curr) => {
    if (curr.type === PipewireItemType.PipeWireInterfaceLink) {
      const inputNode = curr.info?.props?.["link.input.node"];
      const inputPort = curr.info?.props?.["link.input.port"];
      const outputNode = curr.info?.props?.["link.output.node"];
      const outputPort = curr.info?.props?.["link.output.port"];

      if (
        [inputNode, inputPort, outputNode, outputPort].some(
          (item) => item === undefined
        )
      ) {
        throw new Error(
          `one of the input/outputs on a link is undefined ${JSON.stringify(
            curr
          )}`
        );
      }

      const fwKey = `${outputNode}:${outputPort}`;
      const rvKey = `${inputNode}:${inputPort}`;

      if (forwardLinks[fwKey] === undefined) {
        forwardLinks[fwKey] = {
          item: dump.items[outputNode!],
          port: dump.items[outputPort!],
          links: [],
        };
      }
      if (reverseLinks[rvKey] === undefined) {
        reverseLinks[rvKey] = {
          item: dump.items[inputNode!],
          port: dump.items[inputPort!],
          links: [],
        };
      }

      forwardLinks[fwKey].links.push([
        dump.items[inputNode!],
        dump.items[inputPort!],
      ]);
      reverseLinks[rvKey].links.push([
        dump.items[outputNode!],
        dump.items[outputPort!],
      ]);
    }
  });

  dump.links.forward = forwardLinks;
  dump.links.reverse = reverseLinks;
}

export async function pipewireDump(): Promise<PipewireDump> {
  const [stdout, stderr] = await run("pw-dump --color=never");
  if (stderr.length !== 0) {
    error("ERROR");
    error(stderr);
    throw new Error("Failed to get pw-dump");
  }

  const dump = {
    items: {},
    links: {
      forward: {},
      reverse: {},
    },
  };

  updateDump(stdout, dump);
  return dump;
}
