export type Device = {
  name: string;
  buttons: {
    // channel:note
    [key: string]: {
      label: string;
    };
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
