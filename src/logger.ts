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

export function debug(...args: any[]) {
  if (
    process.env.PW_ORCH_DEBUG === "1" ||
    process.env.PW_ORCH_DEBUG === "true"
  ) {
    args.unshift(`[${date()}] [debug]`);
    console.error(...args);
  }
}

export function log(...args: any[]) {
  args.unshift(`[${date()}] [info]`);
  console.error(...args);
}

export function warn(...args: any[]) {
  args.unshift(`[${date()}] [warn]`);
  console.error(...args);
}

export function error(...args: any[]) {
  args.unshift(`[${date()}] [error]`);
  console.error(...args);
}
