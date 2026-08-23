export type FormatStackOpts = {
  label?: string;
  preludeLines?: number;
};

export function findPathRoots(cwd?: string): Array<string>;
export function isRunTemp(file: string): boolean;
export function shortPath(
  file: string,
  roots: Array<string>,
  label?: string,
): string;
export function formatStackText(
  text: string,
  cwd: string,
  opts?: FormatStackOpts,
): string;
