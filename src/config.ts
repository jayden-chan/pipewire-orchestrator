import Ajv from "ajv";
import { readFile } from "fs/promises";
import { parse as YAMLParse } from "yaml";
import { Device, Range } from "./devices";
import { MidiEvent } from "./midi";
import { NodeAndPort } from "./pipewire";

export type MapFunction = "IDENTITY" | "SQUARED" | "SQRT" | "TAPER";

/**
 * Execute a shell command when the binding is activated
 */
export type CommandBinding = {
  type: "command";
  command: string;
  cancelable?: boolean;
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
  range: Range;
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
 * Cancel any current pending action. If there is no pending action
 * then the alt binding will be executed (if specified)
 */
export type CancelBinding = {
  type: "cancel";
  alt?: ActionBinding;
};

/**
 * Turn on or off mute for the given dial
 */
export type ToggleMuteBinding = {
  type: "mute";
  mute: boolean;
  dial: string;
};

export type LV2ShowGUIBinding = {
  type: "lv2::show_gui";
  pluginName: string;
};

export type LV2LoadPresetBinding = {
  type: "lv2::load_preset";
  pluginName: string;
  preset: string;
};

/**
 * Open the selection prompt to assign an application
 * to a mixer channel
 */
export type MixerSelectBinding = {
  type: "mixer::select";
  pendingColor?: string;
  channel: number;
};

/**
 * Create a link between two nodes and ports within PipeWire
 */
export type PipewireLinkBinding = {
  type: "pipewire::link";
  src: NodeAndPort;
  dest: NodeAndPort;
};

/**
 * Create an exclusive link between two nodes and ports within PipeWire.
 * Creating an exclusive link is equivalent to creating a normal link and then
 * destroying all other links originating from source port that aren't the newly
 * created one.
 */
export type PipewireExclusiveLinkBinding = {
  type: "pipewire::exclusive_link";
  src: NodeAndPort;
  dest: NodeAndPort;
};

/**
 * Destroy a link between two nodes and ports within PipeWire
 */
export type PipewireUnLinkBinding = {
  type: "pipewire::unlink";
  src: NodeAndPort;
  dest: NodeAndPort;
};

export type LEDSetBinding = {
  type: "led::set";
  button: string;
  color: string;
};

export type ActionBinding =
  | LV2ShowGUIBinding
  | LV2LoadPresetBinding
  | CommandBinding
  | ToggleMuteBinding
  | MidiBinding
  | PipewireLinkBinding
  | PipewireUnLinkBinding
  | PipewireExclusiveLinkBinding
  | RangeBinding
  | LEDSetBinding
  | MixerSelectBinding;

export type ButtonBindAction =
  | CancelBinding
  | RangeBinding
  | CycleBinding
  | ActionBinding;

/**
 * Actions(s) to execute on a key event such as a key
 * press or release
 */
export type KeyEventAction = {
  actions: ButtonBindAction[];
  color?: string;
};

// can't use a type intersection here with KeyEventAction
// because it breaks typescript-json-schema for some reason

/**
 * Action(s) to execute on long press
 */
export type LongPressAction = {
  actions: ButtonBindAction[];
  color?: string;
  timeout: number;
};

export type ButtonBinding = {
  type: "button";
  onPress?: KeyEventAction;
  onLongPress?: LongPressAction;
  onShiftPress?: KeyEventAction;
  onShiftLongPress?: LongPressAction;
  onRelease?: KeyEventAction;
};

export type DialBinding = PassthroughBinding;

export type Binding = DialBinding | ButtonBinding;

export type Label = string;
export type Bindings = {
  [key: Label]: Binding;
};

export type NodeEventConfig = {
  node: string;
  do: ActionBinding[];
};

export type PipeWireNodeConfig = {
  node: string;
  onConnect?: ActionBinding[];
  onDisconnect?: ActionBinding[];
  mixerChannel?: number | "round_robin";
};

export type LV2Plugin = {
  uri: string;
  name: string;
  host: "jalv" | "jalv.gtk3";
};

export type Config = {
  connections: [string, string][];
  device: string;
  outputMidi: string;
  bindings: Bindings;
  lv2Path?: string;
  pipewire: {
    rules: PipeWireNodeConfig[];
    plugins: LV2Plugin[];
  };
};

export type RuntimeConfig = Omit<Config, "device"> & {
  device: Device;
};

export async function readConfig(path: string): Promise<Config> {
  const contents =
    path.endsWith(".yaml") || path.endsWith(".yml")
      ? YAMLParse(await readFile(path, { encoding: "utf8" }))
      : JSON.parse(await readFile(path, { encoding: "utf8" }));

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
