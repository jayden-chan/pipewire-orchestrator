import { Range } from "./devices";
import Ajv from "ajv";
import { readFile } from "fs/promises";

export type MapFunction = "IDENTITY" | "SQUARED" | "SQRT";

export type DialRange = {
  range: Range;
  color: string;
};

export type Binding =
  | {
      type: "command";
      command: string;
    }
  | {
      type: "passthrough";
      mapFunction?: MapFunction;
      outChannel: number;
      outController: number;
    }
  | {
      type: "range";
      dial: string;
      modes: DialRange[];
    };

export type Bindings = {
  [key: string]: Binding;
};

export type Config = {
  bindings: Bindings;
};

export async function readConfig(path: string): Promise<Config> {
  const contents = JSON.parse(await readFile(path, { encoding: "utf8" }));
  const schema = await readFile(__dirname + "/config-schema.json", {
    encoding: "utf8",
  });

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile<Config>(JSON.parse(schema));

  const valid = validate(contents);
  if (!valid) {
    throw new Error("invalid schema");
  }

  return contents;
}
