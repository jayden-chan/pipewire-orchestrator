import { Device } from ".";

const BUTTON_GRID_LED_STATES = {
  OFF: 0,
  ON: 1,
  GREEN: 1,
  GREEN_FLASHING: 2,
  RED: 3,
  RED_FLASHING: 4,
  AMBER: 5,
  AMBER_FLASHING: 6,
};

const ON_OFF_LED_STATES = {
  OFF: 0,
  ON: 1,
};

export const apcKey25: Device = {
  name: "APC Key 25 MIDI",
  buttons: [
    {
      channel: 0,
      note: 0,
      label: "Button 1",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 1,
      label: "Button 2",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 2,
      label: "Button 3",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 3,
      label: "Button 4",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 4,
      label: "Button 5",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 5,
      label: "Button 6",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 6,
      label: "Button 7",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 7,
      label: "Button 8",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 8,
      label: "Button 9",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 9,
      label: "Button 10",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 10,
      label: "Button 11",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 11,
      label: "Button 12",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 12,
      label: "Button 13",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 13,
      label: "Button 14",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 14,
      label: "Button 15",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 15,
      label: "Button 16",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 16,
      label: "Button 17",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 17,
      label: "Button 18",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 18,
      label: "Button 19",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 19,
      label: "Button 20",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 20,
      label: "Button 21",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 21,
      label: "Button 22",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 22,
      label: "Button 23",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 23,
      label: "Button 24",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 24,
      label: "Button 25",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 25,
      label: "Button 26",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 26,
      label: "Button 27",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 27,
      label: "Button 28",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 28,
      label: "Button 29",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 29,
      label: "Button 30",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 30,
      label: "Button 31",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 31,
      label: "Button 32",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 32,
      label: "Button 33",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 33,
      label: "Button 34",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 34,
      label: "Button 35",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 35,
      label: "Button 36",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 36,
      label: "Button 37",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 37,
      label: "Button 38",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 38,
      label: "Button 39",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    {
      channel: 0,
      note: 39,
      label: "Button 40",
      ledStates: BUTTON_GRID_LED_STATES,
    },
    { channel: 0, note: 64, label: "Up", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 65, label: "Down", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 66, label: "Left", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 67, label: "Right", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 68, label: "Volume", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 69, label: "Pan", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 70, label: "Send", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 71, label: "Device", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 81, label: "Stop All Clips" },
    { channel: 0, note: 82, label: "Clip Stop", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 83, label: "Solo", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 84, label: "Rec Arm", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 85, label: "Mute", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 86, label: "Select", ledStates: ON_OFF_LED_STATES },
    { channel: 0, note: 91, label: "Play/Pause" },
    { channel: 0, note: 93, label: "Rec" },
    { channel: 0, note: 98, label: "Shift" },
  ],
  keys: {
    channel: 1,
  },
  dials: [
    { channel: 0, controller: 48, label: "Dial 1", range: [0, 127] },
    { channel: 0, controller: 49, label: "Dial 2", range: [0, 127] },
    { channel: 0, controller: 50, label: "Dial 3", range: [0, 127] },
    { channel: 0, controller: 51, label: "Dial 4", range: [0, 127] },
    { channel: 0, controller: 52, label: "Dial 5", range: [0, 127] },
    { channel: 0, controller: 53, label: "Dial 6", range: [0, 127] },
    { channel: 0, controller: 54, label: "Dial 7", range: [0, 127] },
    { channel: 0, controller: 55, label: "Dial 8", range: [0, 127] },
  ],
};
