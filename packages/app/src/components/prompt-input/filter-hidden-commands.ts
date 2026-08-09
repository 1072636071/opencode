export function filterHiddenCommands<T extends { type: string; trigger: string }>(
  commands: T[],
  hidden: string[],
): T[] {
  if (hidden.length === 0) return commands
  const hiddenSet = new Set(hidden)
  return commands.filter((cmd) => !(cmd.type === "custom" && hiddenSet.has(cmd.trigger)))
}