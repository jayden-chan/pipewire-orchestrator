import { Readable } from "stream";

export type ProcessStream = Readable;

export type Process = {
  exitCode: number;
  id: string;
};

export class ProcessFailureError extends Error {
  private _exitCode: number;
  private _id: string;

  constructor(message: string, id: string, exitCode: number) {
    super(message);
    this._exitCode = exitCode;
    this._id = id;
  }

  get exitCode(): number {
    return this._exitCode;
  }

  get id(): string {
    return this._id;
  }
}
