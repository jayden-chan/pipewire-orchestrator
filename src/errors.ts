import { error } from "./logger";

export const handleAmidiError = (err: any) =>
  error("failed to send midi to amidi:", err);

export const handlePwLinkError = (err: any) => {
  if (err instanceof Error) {
    if (
      !err.message.includes(
        "failed to unlink ports: No such file or directory"
      ) &&
      !err.message.includes("failed to link ports: File exists")
    ) {
      error(err);
      throw err;
    }
  }
};
