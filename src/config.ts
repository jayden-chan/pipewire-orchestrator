import Ajv from "ajv";
import { readFile } from "fs/promises";
import { Device, Range } from "./devices";
import { MidiEvent } from "./midi";
import { NodeAndPort } from "./pipewire";

export type MapFunction = "IDENTITY" | "SQUARED" | "SQRT" | "TAPER";

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
    actions: ActionBinding[];
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
    do: ActionBinding[];
  };
  onRelease: {
    color?: string;
    do: ActionBinding[];
  };
};

/**
 * Cancel any current pending action. If there is no pending action
 * then the alt binding will be executed (if specified)
 */
export type CancelBinding = {
  type: "cancel";
  alt?: ActionBinding;
};

/**
 * Toggle mute for the given dial
 */
export type ToggleMuteBinding = {
  type: "mute";
  dial: string;
};

export type PipewireLinkBinding = {
  type: "pipewire::link";
  src: NodeAndPort;
  dest: NodeAndPort;
};

export type PipewireExclusiveLinkBinding = {
  type: "pipewire::exclusive_link";
  src: NodeAndPort;
  dest: NodeAndPort;
};

export type PipewireUnLinkBinding = {
  type: "pipewire::unlink";
  src: NodeAndPort;
  dest: NodeAndPort;
};

export type ActionBinding =
  | CommandBinding
  | ToggleMuteBinding
  | MidiBinding
  | PipewireLinkBinding
  | PipewireUnLinkBinding
  | PipewireExclusiveLinkBinding
  | RangeBinding;

export type Binding =
  | PassthroughBinding
  | CancelBinding
  | RangeBinding
  | CycleBinding
  | ActionBinding
  | MomentaryBinding;

export type Bindings = {
  [key: string]: Binding;
};

export type Config = {
  connections: [string, string][];
  device: string;
  virtMidi: string;
  bindings: Bindings;
  pipewire: {
    rules: {
      onConnect: {
        node: string;
        do: ActionBinding[];
      }[];
      onDisconnect: {
        node: string;
        do: ActionBinding[];
      }[];
    };
  };
};

export type RuntimeConfig = Omit<Config, "device"> & {
  device: Device;
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
    console.error("Invalid config file:", validate.errors);
    throw new Error("Invalid config file");
  }

  return contents;
}
