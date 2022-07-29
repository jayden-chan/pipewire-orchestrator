export type Button = {
  label: string;
  ledStates?: {
    [key: string]: number;
  };
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
    [key: string]: {
      label: string;
    };
  };
};
