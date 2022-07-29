export type Range = [number, number];

export type Button = {
  label: string;
  ledStates?: {
    [key: string]: number;
  };
};

export type Dial = {
  label: string;
  range: Range;
};

export type Device = {
  name: string;
  buttons: {
    // channel:note
    [key: string]: Button;
  };
  keys: {
    channel: number;
  };
  dials: {
    // channel:controller
    [key: string]: Dial;
  };
};
