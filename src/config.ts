import { Range } from "./devices";
import Ajv from "ajv";
import { readFile } from "fs/promises";
import { MidiEvent } from "./midi";

export type MapFunction = "IDENTITY" | "SQUARED" | "SQRT";

export type DialRange = {
  range: Range;
  color: string;
};

/**
 * Execute a shell command when the binding is activated
 */
export type CommandBinding = {
  type: "command";
  command: string;
};

/**
 * Pass through the MIDI input to the given channel and controller,
 * optionally passing the input through the mapping function first
 */
export type PassthroughBinding = {
  type: "passthrough";
  mapFunction?: MapFunction;
  outChannel: number;
  outController: number;
};

/**
 * Change the range of a dial when the binding is executed
 */
export type RangeBinding = {
  type: "range";
  dial: string;
  modes: DialRange[];
};

/**
 * Emit a MIDI event when the binding is activated
 */
export type MidiBinding = {
  type: "midi";
  events: MidiEvent[];
};

/**
 * Cycle through the given sub-bindings each time the binding
 * is activated
 */
export type CycleBinding = {
  type: "cycle";
  items: {
    bind: CommandBinding | MidiBinding;
    color?: string;
  }[];
};

/**
 * Specify binds for the press and release events
 * of a given button
 */
export type MomentaryBinding = {
  type: "momentary";
  onPress: {
    color?: string;
    bind: CommandBinding | MidiBinding;
  };
  onRelease: {
    color?: string;
    bind: CommandBinding | MidiBinding;
  };
};

/**
 * Toggle mute for the given dial
 */
export type ToggleMuteBinding = {
  type: "mute";
  dial: string;
};

export type Binding =
  | CommandBinding
  | PassthroughBinding
  | RangeBinding
  | MidiBinding
  | ToggleMuteBinding
  | CycleBinding
  | MomentaryBinding;

export type Bindings = {
  [key: string]: Binding;
};

export type Config = {
  connections: [string, string][];
  device: string;
  virtMidi: string;
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
