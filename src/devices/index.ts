export type Range = [number, number];

export type Button = {
  label: string;
  channel: number;
  note: number;
  ledStates?: {
    [key: string]: number;
  };
};

export type Dial = {
  label: string;
  channel: number;
  controller: number;
  range: Range;
};

export type Device = {
  name: string;
  buttons: Button[];
  keys: {
    channel: number;
  };
  dials: Dial[];
};
