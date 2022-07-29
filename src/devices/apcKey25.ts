import { Device } from ".";

const BUTTON_GRID_LED_STATES = {
  OFF: 0,
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
  buttons: {
    "0:0": { label: "Button 1", ledStates: BUTTON_GRID_LED_STATES },
    "0:1": { label: "Button 2", ledStates: BUTTON_GRID_LED_STATES },
    "0:2": { label: "Button 3", ledStates: BUTTON_GRID_LED_STATES },
    "0:3": { label: "Button 4", ledStates: BUTTON_GRID_LED_STATES },
    "0:4": { label: "Button 5", ledStates: BUTTON_GRID_LED_STATES },
    "0:5": { label: "Button 6", ledStates: BUTTON_GRID_LED_STATES },
    "0:6": { label: "Button 7", ledStates: BUTTON_GRID_LED_STATES },
    "0:7": { label: "Button 8", ledStates: BUTTON_GRID_LED_STATES },
    "0:8": { label: "Button 9", ledStates: BUTTON_GRID_LED_STATES },
    "0:9": { label: "Button 10", ledStates: BUTTON_GRID_LED_STATES },
    "0:10": { label: "Button 11", ledStates: BUTTON_GRID_LED_STATES },
    "0:11": { label: "Button 12", ledStates: BUTTON_GRID_LED_STATES },
    "0:12": { label: "Button 13", ledStates: BUTTON_GRID_LED_STATES },
    "0:13": { label: "Button 14", ledStates: BUTTON_GRID_LED_STATES },
    "0:14": { label: "Button 15", ledStates: BUTTON_GRID_LED_STATES },
    "0:15": { label: "Button 16", ledStates: BUTTON_GRID_LED_STATES },
    "0:16": { label: "Button 17", ledStates: BUTTON_GRID_LED_STATES },
    "0:17": { label: "Button 18", ledStates: BUTTON_GRID_LED_STATES },
    "0:18": { label: "Button 19", ledStates: BUTTON_GRID_LED_STATES },
    "0:19": { label: "Button 20", ledStates: BUTTON_GRID_LED_STATES },
    "0:20": { label: "Button 21", ledStates: BUTTON_GRID_LED_STATES },
    "0:21": { label: "Button 22", ledStates: BUTTON_GRID_LED_STATES },
    "0:22": { label: "Button 23", ledStates: BUTTON_GRID_LED_STATES },
    "0:23": { label: "Button 24", ledStates: BUTTON_GRID_LED_STATES },
    "0:24": { label: "Button 25", ledStates: BUTTON_GRID_LED_STATES },
    "0:25": { label: "Button 26", ledStates: BUTTON_GRID_LED_STATES },
    "0:26": { label: "Button 27", ledStates: BUTTON_GRID_LED_STATES },
    "0:27": { label: "Button 28", ledStates: BUTTON_GRID_LED_STATES },
    "0:28": { label: "Button 29", ledStates: BUTTON_GRID_LED_STATES },
    "0:29": { label: "Button 30", ledStates: BUTTON_GRID_LED_STATES },
    "0:30": { label: "Button 31", ledStates: BUTTON_GRID_LED_STATES },
    "0:31": { label: "Button 32", ledStates: BUTTON_GRID_LED_STATES },
    "0:32": { label: "Button 33", ledStates: BUTTON_GRID_LED_STATES },
    "0:33": { label: "Button 34", ledStates: BUTTON_GRID_LED_STATES },
    "0:34": { label: "Button 35", ledStates: BUTTON_GRID_LED_STATES },
    "0:35": { label: "Button 36", ledStates: BUTTON_GRID_LED_STATES },
    "0:36": { label: "Button 37", ledStates: BUTTON_GRID_LED_STATES },
    "0:37": { label: "Button 38", ledStates: BUTTON_GRID_LED_STATES },
    "0:38": { label: "Button 39", ledStates: BUTTON_GRID_LED_STATES },
    "0:39": { label: "Button 40", ledStates: BUTTON_GRID_LED_STATES },
    "0:64": { label: "Up", ledStates: ON_OFF_LED_STATES },
    "0:65": { label: "Down", ledStates: ON_OFF_LED_STATES },
    "0:66": { label: "Left", ledStates: ON_OFF_LED_STATES },
    "0:67": { label: "Right", ledStates: ON_OFF_LED_STATES },
    "0:68": { label: "Volume", ledStates: ON_OFF_LED_STATES },
    "0:69": { label: "Pan", ledStates: ON_OFF_LED_STATES },
    "0:70": { label: "Send", ledStates: ON_OFF_LED_STATES },
    "0:71": { label: "Device", ledStates: ON_OFF_LED_STATES },
    "0:81": { label: "Stop All Clips" },
    "0:82": { label: "Clip Stop", ledStates: ON_OFF_LED_STATES },
    "0:83": { label: "Solo", ledStates: ON_OFF_LED_STATES },
    "0:84": { label: "Rec Arm", ledStates: ON_OFF_LED_STATES },
    "0:85": { label: "Mute", ledStates: ON_OFF_LED_STATES },
    "0:86": { label: "Select", ledStates: ON_OFF_LED_STATES },
    "0:91": { label: "Play/Pause" },
    "0:93": { label: "Rec" },
    "0:98": { label: "Shift" },
  },
  keys: {
    channel: 1,
  },
  dials: {
    "0:48": { label: "Dial 1" },
    "0:49": { label: "Dial 2" },
    "0:50": { label: "Dial 3" },
    "0:51": { label: "Dial 4" },
    "0:52": { label: "Dial 5" },
    "0:53": { label: "Dial 6" },
    "0:54": { label: "Dial 7" },
    "0:55": { label: "Dial 8" },
  },
};
