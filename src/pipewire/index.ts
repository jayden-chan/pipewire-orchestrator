import { spawn } from "child_process";
import { Readable } from "stream";
import { handlePwLinkError } from "../errors";
import { error, log, warn } from "../logger";
import { run } from "../util";
import { Convert, PipewireItem, PipewireItemType } from "./types";

export const findPwNode = (searchTerm: string) => {
  return (item: PipewireItem) => {
    if (item.type !== PipewireItemType.PipeWireInterfaceNode) {
      return false;
    }

    const desc = item.info?.props?.["node.description"];
    const name = item.info?.props?.["node.name"];
    return desc === searchTerm || name === searchTerm;
  };
};

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

export type NodeWithPorts = {
  node: PipewireItem;
  ports: PipewireItem[];
};

export function audioClients(dump: PipewireDump): NodeWithPorts[] {
  const pwVals = Object.values(dump.items);
  const pwPorts = pwVals.filter(
    (i) => i.type === PipewireItemType.PipeWireInterfacePort
  );

  return pwVals
    .map((e) => {
      if (e.info?.props?.["application.name"] === undefined) {
        return undefined;
      }

      const outputPorts = pwPorts.filter(
        (p) =>
          p.info?.props?.["node.id"] === e.id &&
          p.info?.["direction"] === "output" &&
          !p.info?.props?.["port.name"]?.toLowerCase().includes("monitor")
      );

      if (outputPorts.length === 0) {
        return undefined;
      }

      return { node: e, ports: outputPorts };
    })
    .filter((i) => i !== undefined) as NodeWithPorts[];
}

export function mixerPorts(
  dump: PipewireDump
): Record<string, NodeWithPorts> | undefined {
  const pwVals = Object.values(dump.items);
  const pwPorts = pwVals.filter(
    (i) => i.type === PipewireItemType.PipeWireInterfacePort
  );

  const mixer = pwVals.find(
    (e) => e.info?.props?.["node.description"] === "Mixer"
  );

  if (mixer === undefined) {
    error("[mixerPorts] could not find mixer node");
    return;
  }

  return Object.fromEntries(
    pwPorts
      .filter(
        (i) =>
          i.info?.props?.["node.id"] === mixer.id &&
          i.info?.props?.["format.dsp"]?.includes("audio") &&
          i.info?.direction === "input"
      )
      .reduce((acc, curr, i, arr) => {
        if (i % 2 === 0) {
          acc.push([
            `Mixer Channel ${acc.length + 1}`,
            { node: curr, ports: [curr, arr[i + 1]] },
          ]);
        }
        return acc;
      }, [] as [string, NodeWithPorts][])
  );
}

export async function connectAppToMixer(
  app: NodeWithPorts,
  channel: NodeWithPorts,
  dump: PipewireDump
) {
  const sourceNodeId = app.node.id;

  app.ports.forEach((port) => {
    const sourcePortId = port.id;
    const destPort =
      port.info?.props?.["audio.channel"] === "FL"
        ? channel.ports[0]
        : channel.ports[1];

    const sourceName = port.info?.props?.["port.alias"];
    const destName = destPort.info?.props?.["port.alias"];

    const command = `pw-link "${sourceName}" "${destName}"`;
    log(`[command] ${command}`);
    const proms = [run(command).catch(handlePwLinkError)];

    const key = `${sourceNodeId}:${sourcePortId}`;
    const srcLinks = dump.links.forward[key];
    if (srcLinks !== undefined) {
      // remove any links that aren't the exclusive one specified
      srcLinks.links.forEach(([, dPort]) => {
        if (dPort.id !== destPort.id) {
          const dName = dPort.info?.props?.["port.alias"];
          const command = `pw-link -d "${sourceName}" "${dName}"`;
          log(`[command] ${command}`);
          proms.push(run(command).catch(handlePwLinkError));
        }
      });
    }

    return Promise.all(proms);
  });
}

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

  const srcNode = items.find(findPwNode(src.node));
  if (srcNode === undefined) {
    warn(`[pw-link] failed to locate src node "${src.node}"`);
    return undefined;
  }

  const destNode = items.find(findPwNode(dest.node));
  if (destNode === undefined) {
    warn(`[pw-link] failed to locate dest node "${dest.node}"`);
    return undefined;
  }

  const srcPort = items.find(
    (item) =>
      item.type === PipewireItemType.PipeWireInterfacePort &&
      item.info?.props?.["node.id"] === srcNode.id &&
      item.info?.props?.["port.name"] === src.port
  );

  if (srcPort === undefined) {
    warn(`[pw-link] failed to locate src port "${src.port}"`);
    return undefined;
  }

  const destPort = items.find(
    (item) =>
      item.type === PipewireItemType.PipeWireInterfacePort &&
      item.info?.props?.["node.id"] === destNode.id &&
      item.info?.props?.["port.name"] === dest.port
  );

  if (destPort === undefined) {
    warn(`[pw-link] failed to locate dest port "${dest.port}"`);
    return undefined;
  }

  return { srcNode, srcPort, destNode, destPort };
}

async function modifyLink(
  src: NodeAndPort,
  dest: NodeAndPort,
  dump: PipewireDump,
  mode: "ensure" | "destroy"
): Promise<void> {
  const linkItems = findLinkPair(src, dest, dump);
  if (linkItems === undefined) {
    return;
  }

  const { srcNode, srcPort, destNode } = linkItems;
  const srcLinks = dump.links.forward[`${srcNode.id}:${srcPort.id}`];
  if (
    mode === "ensure" &&
    (srcLinks === undefined ||
      !srcLinks.links.some((link) => link[0].id === destNode.id))
  ) {
    const command = `pw-link "${src.node}:${src.port}" "${dest.node}:${dest.port}"`;
    log(`[command] ${command}`);
    await run(command);
  } else if (
    mode === "destroy" &&
    srcLinks?.links.some((link) => link[0].id === destNode.id)
  ) {
    const command = `pw-link -d "${src.node}:${src.port}" "${dest.node}:${dest.port}"`;
    log(`[command] ${command}`);
    await run(command);
  }
}

export async function ensureLink(
  src: NodeAndPort,
  dest: NodeAndPort,
  dump: PipewireDump
): Promise<void> {
  await modifyLink(src, dest, dump, "ensure");
}

export async function destroyLink(
  src: NodeAndPort,
  dest: NodeAndPort,
  dump: PipewireDump
): Promise<void> {
  await modifyLink(src, dest, dump, "destroy");
}

export async function exclusiveLink(
  src: NodeAndPort,
  dest: NodeAndPort,
  dump: PipewireDump
): Promise<void> {
  const linkItems = findLinkPair(src, dest, dump);
  if (linkItems === undefined) {
    return;
  }

  const { srcNode, srcPort, destPort } = linkItems;
  const srcLinks = dump.links.forward[`${srcNode.id}:${srcPort.id}`];
  if (srcLinks !== undefined) {
    // remove any links that aren't the exclusive one specified
    const sourceName = srcPort.info?.props?.["port.alias"];
    srcLinks.links.forEach(([, dPort]) => {
      if (dPort.id !== destPort.id) {
        const destName = dPort.info?.props?.["port.alias"];
        const command = `pw-link -d "${sourceName}" "${destName}"`;
        log(`[command] ${command}`);
        run(command).catch(handlePwLinkError);
      }
    });
  }

  await modifyLink(src, dest, dump, "ensure");
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

      // the node process will buffer the output data and give it to us in chunks.
      // we need to figure out when we have a full chunk of JSON that we are able
      // to parse and emit to the output stream. I think there's a way of disabling
      // the buffering but this solution seems to work fine
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
