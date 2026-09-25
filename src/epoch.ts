/**
 * A counter the `/input` command advances before it writes settings.
 *
 * The settings watcher may already be holding an older copy of the model
 * list. It compares this counter before its own write and discards that copy
 * when the command has moved, so a manual choice is not overwritten.
 */
let epoch = 0

/** Advance the counter. Returns the value after the advance. */
export function bumpSettingsEpoch(): number {
  epoch += 1
  return epoch
}

/** The current counter. */
export function settingsEpoch(): number {
  return epoch
}
