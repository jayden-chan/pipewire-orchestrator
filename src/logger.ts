import { createWriteStream } from "fs";
import { format } from "util";

export function date() {
  const currentDate = new Date();
  const dd = `${currentDate.getDate()}`.padStart(2, "0");
  const MM = `${currentDate.getMonth() + 1}`.padStart(2, "0");
  const yy = `${currentDate.getFullYear()}`.padStart(4, "0");
  const hh = `${currentDate.getHours()}`.padStart(2, "0");
  const mm = `${currentDate.getMinutes()}`.padStart(2, "0");
  const ss = `${currentDate.getSeconds()}`.padStart(2, "0");
  return `${yy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

export function dateISO() {
  const currentDate = new Date();
  const dd = `${currentDate.getDate()}`.padStart(2, "0");
  const MM = `${currentDate.getMonth() + 1}`.padStart(2, "0");
  const yy = `${currentDate.getFullYear()}`.padStart(4, "0");
  const hh = `${currentDate.getHours()}`.padStart(2, "0");
  const mm = `${currentDate.getMinutes()}`.padStart(2, "0");
  const ss = `${currentDate.getSeconds()}`.padStart(2, "0");
  return `${yy}-${MM}-${dd}T${hh}:${mm}:${ss}`;
}

const writeStream =
  (process.env.PW_ORCH_LOGFILE ?? "") !== ""
    ? createWriteStream(process.env.PW_ORCH_LOGFILE!)
    : undefined;

if (writeStream) {
  ["SIGINT", "SIGTERM"].forEach((sig) =>
    process.on(sig, () => {
      writeStream.close();
    })
  );
}

function logWrite(...args: any[]): void {
  console.error(...args);
  if (writeStream !== undefined && writeStream.writable) {
    try {
      writeStream.write(Buffer.from(format(...args) + "\n"));
    } catch {
      // ignore
    }
  }
}

let debug: (...args: any[]) => void;
let log: (...args: any[]) => void;
let warn: (...args: any[]) => void;
let error: (...args: any[]) => void;

type Log = {
  level: string;
  message: string;
  timestamp: string;
  [key: string]: any;
};

const logFromArg = (args: any[]): Omit<Log, "level"> => {
  if (
    args.length === 1 &&
    typeof args[0] === "object" &&
    "message" in args[0]
  ) {
    return {
      ...args[0],
      timestamp: dateISO(),
    };
  }

  // first argument is a tag, strip it and put it in the JSON metadata
  if (
    typeof args[0] === "string" &&
    args[0].startsWith("[") &&
    args[0].endsWith("]")
  ) {
    return {
      timestamp: dateISO(),
      label: args[0],
      message: args
        .slice(1)
        .map((arg) => {
          if (typeof arg === "object") {
            return JSON.stringify(arg);
          }
          return `${arg}`;
        })
        .join(" "),
    };
  }

  return {
    timestamp: dateISO(),
    message: args
      .map((arg) => {
        if (typeof arg === "object") {
          return JSON.stringify(arg);
        }
        return `${arg}`;
      })
      .join(" "),
  };
};

if (
  process.env.PW_ORCH_JSON_LOGS === "1" ||
  process.env.PW_ORCH_JSON_LOGS === "true"
) {
  debug = (...args: any[]) => {
    console.error(
      JSON.stringify({
        level: "debug",
        ...logFromArg(args),
      })
    );
  };
  log = (...args: any[]) => {
    console.error(
      JSON.stringify({
        level: "info",
        ...logFromArg(args),
      })
    );
  };
  warn = (...args: any[]) => {
    console.error(
      JSON.stringify({
        level: "warn",
        ...logFromArg(args),
      })
    );
  };
  error = (...args: any[]) => {
    console.error(
      JSON.stringify({
        level: "error",
        ...logFromArg(args),
      })
    );
  };
} else {
  debug = (...args: any) => {
    if (
      process.env.PW_ORCH_DEBUG === "1" ||
      process.env.PW_ORCH_DEBUG === "true"
    ) {
      args.unshift(`[${date()}] [debug]`);
      logWrite(...args);
    }
  };

  log = (...args: any[]) => {
    args.unshift(`[${date()}] [info]`);
    logWrite(...args);
  };

  warn = (...args: any[]) => {
    args.unshift(`[${date()}] [warn]`);
    logWrite(...args);
  };

  error = (...args: any[]) => {
    args.unshift(`[${date()}] [error]`);
    logWrite(...args);
  };
}

export { debug, log, warn, error };
