import { Convert, PipewireItem, PipewireItemType } from "./types";
import { run } from "../util";

export type Links = {
  [key: string]: [string, string][];
};

export type NewLinks = {
  [key: string]: {
    item: PipewireItem;
    port: PipewireItem;
    links: [PipewireItem, PipewireItem][];
  };
};

export type PipewireItems = {
  [key: number]: PipewireItem;
};

export type PipewireDump = {
  items: PipewireItems;
  links: {
    forward: NewLinks;
    reverse: NewLinks;
  };
};

export async function pipewireDump(): Promise<PipewireDump> {
  const [stdout, stderr] = await run("pw-dump --color=never");
  if (stderr.length !== 0) {
    console.error("ERROR");
    console.error(stderr);
    throw new Error("Failed to get pw-dump");
  }

  let parsed: PipewireItem[];
  try {
    parsed = Convert.toPipewireItems(stdout);
  } catch (e) {
    console.error("failed to parse");
    console.error(e);
    throw e;
  }

  const forwardLinks: NewLinks = {};
  const reverseLinks: NewLinks = {};

  const items = parsed.reduce((acc, curr) => {
    acc[curr.id] = curr;
    return acc;
  }, {} as PipewireItems);

  parsed.forEach((curr) => {
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
          item: items[outputNode!],
          port: items[outputPort!],
          links: [],
        };
      }
      if (reverseLinks[rvKey] === undefined) {
        reverseLinks[rvKey] = {
          item: items[inputNode!],
          port: items[inputPort!],
          links: [],
        };
      }

      forwardLinks[fwKey].links.push([items[inputNode!], items[inputPort!]]);
      reverseLinks[rvKey].links.push([items[outputNode!], items[outputPort!]]);
    }
  });

  return {
    items,
    links: {
      forward: forwardLinks,
      reverse: reverseLinks,
    },
  };
}
